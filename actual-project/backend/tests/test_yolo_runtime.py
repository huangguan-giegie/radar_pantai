from __future__ import annotations

from io import BytesIO
from pathlib import Path
import sys
from types import SimpleNamespace

import numpy as np
from PIL import Image

import recognition
from recognition import DEFAULT_MODEL_PATH, LitterRecognizer


def jpeg_bytes(size: tuple[int, int] = (320, 320)) -> bytes:
    output = BytesIO()
    Image.new("RGB", size, "white").save(output, format="JPEG")
    return output.getvalue()


class RecordingModel:
    names = {0: "plastic", 1: "metal"}

    def __init__(self, detections=None):
        self.sources: list[tuple[int, int]] = []
        self.detections = detections or []

    def predict(self, *, source, **_kwargs):
        self.sources.append(source.size)
        boxes = SimpleNamespace(
            cls=np.asarray([item[0] for item in self.detections], dtype=np.float32),
            conf=np.asarray([item[1] for item in self.detections], dtype=np.float32),
            xyxy=np.asarray([item[2] for item in self.detections], dtype=np.float32).reshape(-1, 4),
        )
        return [SimpleNamespace(boxes=boxes, names=self.names)]


def fake_onnxruntime(model_path: Path):
    sessions = []

    class FakeSessionOptions:
        def __init__(self):
            self.intra_op_num_threads = None
            self.inter_op_num_threads = None
            self.graph_optimization_level = None

    class FakeSession:
        def __init__(self, path: str, sess_options=None, providers=None):
            assert path == str(model_path)
            self.sess_options = sess_options
            self.providers = providers
            self.calls: list[dict[str, np.ndarray]] = []
            sessions.append(self)

        def get_inputs(self):
            return [SimpleNamespace(name="images", shape=[1, 3, 320, 320])]

        def run(self, _outputs, feed):
            self.calls.append(feed)
            if len(self.calls) == 1:
                return [np.zeros((1, 300, 6), dtype=np.float32)]
            detections = np.zeros((1, 300, 6), dtype=np.float32)
            detections[0, 0] = [10, 20, 100, 120, 0.90, 0]
            detections[0, 1] = [30, 40, 150, 160, 0.80, 5]
            return [detections]

    runtime = SimpleNamespace(
        SessionOptions=FakeSessionOptions,
        GraphOptimizationLevel=SimpleNamespace(ORT_ENABLE_ALL="all"),
        InferenceSession=FakeSession,
    )
    return runtime, sessions


def test_default_production_model_is_onnx():
    assert DEFAULT_MODEL_PATH.suffix == ".onnx"


def test_model_load_uses_onnx_cpu_session_and_warmup(tmp_path, monkeypatch):
    model_path = tmp_path / "model.onnx"
    model_path.write_bytes(b"onnx-model-bytes-" * 16)
    runtime, sessions = fake_onnxruntime(model_path)

    monkeypatch.setitem(sys.modules, "onnxruntime", runtime)
    monkeypatch.setenv("LITTER_ONNX_MODEL_PATH", str(model_path))
    monkeypatch.setenv("LITTER_INFERENCE_SIZE", "320")

    recognizer = LitterRecognizer.load()

    assert recognizer.model is not None
    assert len(sessions) == 1
    session = sessions[0]
    assert session.providers == ["CPUExecutionProvider"]
    assert session.sess_options.intra_op_num_threads == 1
    assert session.sess_options.inter_op_num_threads == 1
    assert len(session.calls) == 1
    warmup = session.calls[0]["images"]
    assert warmup.shape == (1, 3, 320, 320)
    assert warmup.dtype == np.float32


def test_onnx_low_memory_is_opt_in(tmp_path, monkeypatch):
    model_path = tmp_path / "model.onnx"
    model_path.write_bytes(b"onnx-model-bytes-" * 16)
    runtime, sessions = fake_onnxruntime(model_path)
    monkeypatch.setitem(sys.modules, "onnxruntime", runtime)
    monkeypatch.setenv("LITTER_ONNX_MODEL_PATH", str(model_path))
    monkeypatch.setenv("RADAR_ONNX_LOW_MEMORY", "1")

    recognizer = LitterRecognizer.load()

    assert recognizer.model is not None
    assert sessions[0].sess_options.enable_cpu_mem_arena is False
    assert sessions[0].sess_options.enable_mem_pattern is False
    assert len(sessions[0].calls) == 1


def test_onnx_recognition_preserves_six_class_mapping(tmp_path, monkeypatch):
    model_path = tmp_path / "model.onnx"
    model_path.write_bytes(b"onnx-model-bytes-" * 16)
    runtime, sessions = fake_onnxruntime(model_path)

    monkeypatch.setitem(sys.modules, "onnxruntime", runtime)
    monkeypatch.setenv("LITTER_ONNX_MODEL_PATH", str(model_path))
    monkeypatch.setenv("LITTER_INFERENCE_SIZE", "320")

    recognizer = LitterRecognizer.load()
    result = recognizer.recognise(jpeg_bytes())

    assert result["state"] == "ready"
    assert result["counts"]["Plastic"] == 1
    assert result["counts"]["Fishing gear"] == 1
    assert sum(result["counts"].values()) == 2
    assert result["detections"][0]["modelClass"] == "plastic"
    assert result["detections"][0]["box"] == [10.0, 20.0, 100.0, 120.0]
    assert len(sessions[0].calls) == 2


def test_scene_photo_uses_bounded_sequential_regions():
    model = RecordingModel()
    recognizer = LitterRecognizer(model, "test", inference_size=320)

    result = recognizer.recognise(jpeg_bytes((500, 635)))

    assert 2 <= len(model.sources) <= 5
    assert all(width <= 500 and height <= 635 for width, height in model.sources)
    assert result["state"] == "ready"


def test_confident_full_image_uses_one_small_copy_and_preserves_coordinates():
    model = RecordingModel([(0, 0.9, [10, 20, 100, 120])])
    result = LitterRecognizer(model, "test").recognise(jpeg_bytes((1920, 1280)))

    assert model.sources == [(960, 640)]
    assert result["counts"]["Plastic"] == 1
    assert result["detections"][0]["box"] == [20.0, 40.0, 200.0, 240.0]


def test_low_confidence_full_image_falls_back_to_all_four_tiles():
    model = RecordingModel([(0, 0.3, [10, 20, 100, 120])])
    result = LitterRecognizer(model, "test").recognise(jpeg_bytes((1920, 1280)))

    assert len(model.sources) == 5
    assert all(max(size) <= 960 for size in model.sources)
    assert result["state"] == "ready"


def test_crop_detections_are_translated_to_original_coordinates():
    class SecondRegionModel(RecordingModel):
        def predict(self, *, source, **_kwargs):
            self.sources.append(source.size)
            detections = [] if len(self.sources) != 3 else [(0, 0.9, [10, 20, 100, 120])]
            boxes = SimpleNamespace(
                cls=np.asarray([item[0] for item in detections], dtype=np.float32),
                conf=np.asarray([item[1] for item in detections], dtype=np.float32),
                xyxy=np.asarray([item[2] for item in detections], dtype=np.float32).reshape(-1, 4),
            )
            return [SimpleNamespace(boxes=boxes, names=self.names)]

    model = SecondRegionModel()
    recognizer = LitterRecognizer(model, "test", inference_size=320)

    result = recognizer.recognise(jpeg_bytes((500, 635)))

    assert len(model.sources) == 5
    assert result["detections"] == [{
        "modelClass": "plastic",
        "category": "Plastic",
        "confidence": 0.9,
        "box": [235.0, 20.0, 325.0, 120.0],
    }]


def test_overlapping_detections_are_deduplicated_per_class():
    deduplicate = getattr(recognition, "_deduplicate_detections", None)
    assert callable(deduplicate)
    merged = deduplicate([
        {"classId": 0, "confidence": 0.90, "box": [100, 100, 160, 160]},
        {"classId": 0, "confidence": 0.80, "box": [104, 104, 158, 158]},
        {"classId": 1, "confidence": 0.70, "box": [104, 104, 158, 158]},
    ])

    assert len(merged) == 2
    assert {d["classId"] for d in merged} == {0, 1}


def test_runtime_requirements_exclude_torch_and_use_onnxruntime():
    requirements = (Path(__file__).resolve().parents[1] / "requirements.txt").read_text(encoding="utf-8")
    assert "onnxruntime==" in requirements
    assert "torch==" not in requirements
    assert "torchvision==" not in requirements
    assert "ultralytics" not in requirements
