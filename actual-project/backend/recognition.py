"""Optional local YOLO inference for report and cleanup photos.

The production detector uses an embedded-NMS ONNX export so the 512 MiB
Render service does not need PyTorch or Ultralytics at runtime. A missing LFS
checkout or unavailable runtime still leaves manual confirmation available.
"""

from __future__ import annotations

from io import BytesIO
import os
from pathlib import Path
from types import SimpleNamespace
from threading import Lock
from typing import Any

import numpy as np
from PIL import Image


MODEL_CLASS_NAMES = {
    0: "plastic",
    1: "metal",
    2: "glass",
    3: "paper_cardboard",
    4: "styrofoam",
    5: "fishing_gear",
}
MODEL_CLASSES = {
    "plastic": "Plastic",
    "metal": "Metal",
    "glass": "Glass",
    "paper_cardboard": "Paper",
    "styrofoam": "Other",
    "fishing_gear": "Fishing gear",
}
FRONTEND_CATEGORIES = ("Fishing gear", "Plastic", "Glass", "Metal", "Other", "Paper")
DEFAULT_MODEL_PATH = Path(__file__).resolve().parent.parent / "ml-model" / "models" / "sea_taco_yolo11m_best.onnx"
DEFAULT_INFERENCE_SIZE = 320
RECOGNITION_MAX_EDGE = 960
FULL_IMAGE_CONFIDENCE_THRESHOLD = 0.5


def _inference_regions(source: Image.Image, minimum_size: int = DEFAULT_INFERENCE_SIZE):
    """Yield the full image and at most four overlapping image regions."""
    yield 0, 0, source
    width, height = source.size
    if max(width, height) <= minimum_size:
        return

    x_split = max(1, width // 2)
    y_split = max(1, height // 2)
    overlap_x = max(1, width // 20)
    overlap_y = max(1, height // 20)
    boxes = (
        (0, 0, min(width, x_split + overlap_x), min(height, y_split + overlap_y)),
        (max(0, x_split - overlap_x), 0, width, min(height, y_split + overlap_y)),
        (0, max(0, y_split - overlap_y), min(width, x_split + overlap_x), height),
        (max(0, x_split - overlap_x), max(0, y_split - overlap_y), width, height),
    )
    for left, top, right, bottom in boxes:
        yield left, top, source.crop((left, top, right, bottom))


def _box_iou(first: list[float], second: list[float]) -> float:
    left = max(first[0], second[0])
    top = max(first[1], second[1])
    right = min(first[2], second[2])
    bottom = min(first[3], second[3])
    intersection = max(0.0, right - left) * max(0.0, bottom - top)
    first_area = max(0.0, first[2] - first[0]) * max(0.0, first[3] - first[1])
    second_area = max(0.0, second[2] - second[0]) * max(0.0, second[3] - second[1])
    union = first_area + second_area - intersection
    return intersection / union if union > 0.0 else 0.0


def _deduplicate_detections(detections: list[dict[str, Any]], iou_threshold: float = 0.5):
    """Keep the highest-confidence box when overlapping detections share a class."""
    ordered = sorted(detections, key=lambda item: float(item.get("confidence") or 0.0), reverse=True)
    kept: list[dict[str, Any]] = []
    for detection in ordered:
        box = detection.get("box")
        class_key = detection.get("classId", detection.get("modelClass", detection.get("category")))
        if box is not None and any(
            class_key == other.get("classId", other.get("modelClass", other.get("category")))
            and other.get("box") is not None
            and _box_iou(box, other["box"]) > iou_threshold
            for other in kept
        ):
            continue
        kept.append(detection)
    return kept


class OnnxYoloModel:
    """Small adapter that preserves the result shape expected by LitterRecognizer."""

    names = MODEL_CLASS_NAMES

    def __init__(self, session: Any):
        self.session = session
        self.input_name = session.get_inputs()[0].name

    @staticmethod
    def _letterbox(source: Image.Image, size: int) -> tuple[np.ndarray, float, float, float]:
        width, height = source.size
        if width <= 0 or height <= 0:
            raise ValueError("Image dimensions must be positive")
        scale = min(size / width, size / height)
        resized_width = max(1, min(size, round(width * scale)))
        resized_height = max(1, min(size, round(height * scale)))
        resized = source.resize((resized_width, resized_height), Image.Resampling.BILINEAR)
        canvas = Image.new("RGB", (size, size), (114, 114, 114))
        pad_x = (size - resized_width) / 2
        pad_y = (size - resized_height) / 2
        canvas.paste(resized, (round(pad_x), round(pad_y)))
        array = np.asarray(canvas, dtype=np.float32) / 255.0
        tensor = np.ascontiguousarray(array.transpose(2, 0, 1)[None, ...])
        resized.close()
        canvas.close()
        return tensor, scale, pad_x, pad_y

    def predict(
        self,
        *,
        source: Image.Image,
        conf: float = 0.25,
        iou: float = 0.7,
        imgsz: int = DEFAULT_INFERENCE_SIZE,
        device: str = "cpu",
        batch: int = 1,
        verbose: bool = False,
    ) -> list[Any]:
        del iou, verbose
        if device != "cpu" or batch != 1:
            raise ValueError("ONNX production inference is CPU-only with batch=1")
        tensor, scale, pad_x, pad_y = self._letterbox(source, imgsz)
        outputs = self.session.run(None, {self.input_name: tensor})
        if not outputs:
            rows = np.empty((0, 6), dtype=np.float32)
        else:
            rows = np.asarray(outputs[0], dtype=np.float32)
            if rows.ndim == 3:
                rows = rows[0]
            if rows.ndim != 2 or rows.shape[-1] < 6:
                raise ValueError(f"Unexpected ONNX output shape: {rows.shape}")

        class_ids: list[float] = []
        confidences: list[float] = []
        coordinates: list[list[float]] = []
        original_width, original_height = source.size
        for row in rows:
            confidence = float(row[4])
            class_id = int(round(float(row[5])))
            if confidence < conf or class_id not in self.names:
                continue
            x1 = (float(row[0]) - pad_x) / scale
            y1 = (float(row[1]) - pad_y) / scale
            x2 = (float(row[2]) - pad_x) / scale
            y2 = (float(row[3]) - pad_y) / scale
            x1 = min(max(x1, 0.0), float(original_width))
            y1 = min(max(y1, 0.0), float(original_height))
            x2 = min(max(x2, 0.0), float(original_width))
            y2 = min(max(y2, 0.0), float(original_height))
            if x2 <= x1 or y2 <= y1:
                continue
            class_ids.append(float(class_id))
            confidences.append(confidence)
            coordinates.append([x1, y1, x2, y2])

        boxes = SimpleNamespace(
            cls=np.asarray(class_ids, dtype=np.float32),
            conf=np.asarray(confidences, dtype=np.float32),
            xyxy=np.asarray(coordinates, dtype=np.float32).reshape(-1, 4),
        )
        return [SimpleNamespace(boxes=boxes, names=self.names)]


class LitterRecognizer:
    def __init__(
        self,
        model: Any | None,
        version: str,
        unavailable_reason: str | None = None,
        inference_size: int = DEFAULT_INFERENCE_SIZE,
    ):
        self.model = model
        self.version = version
        self.unavailable_reason = unavailable_reason
        self.inference_size = inference_size
        self._inference_lock = Lock()

    @classmethod
    def load(cls) -> "LitterRecognizer":
        model_path = Path(os.getenv("LITTER_ONNX_MODEL_PATH", str(DEFAULT_MODEL_PATH))).expanduser()
        version = os.getenv("LITTER_MODEL_VERSION", "sea-taco-yolo11m-best-onnx/1")
        try:
            inference_size = int(os.getenv("LITTER_INFERENCE_SIZE", str(DEFAULT_INFERENCE_SIZE)))
            if inference_size <= 0:
                raise ValueError("LITTER_INFERENCE_SIZE must be positive")
            if not model_path.is_file():
                return cls(None, version, "weights_missing", inference_size=inference_size)
            with model_path.open("rb") as model_file:
                if model_file.read(64).startswith(b"version https://git-lfs.github.com/spec/v1"):
                    return cls(None, version, "git_lfs_weights_not_downloaded", inference_size=inference_size)

            import onnxruntime as ort

            session_options = ort.SessionOptions()
            session_options.intra_op_num_threads = 1
            session_options.inter_op_num_threads = 1
            session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            # Opt-in experiment only: disabling ONNX memory arenas/patterns may
            # lower resident usage at the cost of slower or less stable latency.
            # Keep inference, models, and the production default unchanged.
            if os.getenv("RADAR_ONNX_LOW_MEMORY", "").lower() in {"1", "true", "yes", "on"}:
                session_options.enable_cpu_mem_arena = False
                session_options.enable_mem_pattern = False
            session = ort.InferenceSession(
                str(model_path),
                sess_options=session_options,
                providers=["CPUExecutionProvider"],
            )
            recognizer = cls(OnnxYoloModel(session), version, inference_size=inference_size)
            warmup_source = Image.new("RGB", (inference_size, inference_size), "black")
            try:
                recognizer._predict(warmup_source)
            finally:
                warmup_source.close()
            return recognizer
        except Exception as error:  # startup must remain available for manual entry
            return cls(None, version, f"model_load_failed:{type(error).__name__}")

    def _predict(self, source: Image.Image) -> Any:
        # Share one model across request threads without concurrent tensor peaks.
        with self._inference_lock:
            return self.model.predict(
                source=source,
                conf=0.25,
                iou=0.7,
                imgsz=self.inference_size,
                device="cpu",
                batch=1,
                verbose=False,
            )

    def recognise(self, image_bytes: bytes) -> dict[str, Any]:
        if self.model is None:
            return {
                "state": "unavailable",
                "modelVersion": self.version,
                "counts": {category: 0 for category in FRONTEND_CATEGORIES},
                "detections": [],
                "reason": self.unavailable_reason,
            }
        try:
            with Image.open(BytesIO(image_bytes)) as image:
                source = image.convert("RGB")
            try:
                candidates: list[dict[str, Any]] = []
                original_width, original_height = source.size
                source.thumbnail((RECOGNITION_MAX_EDGE, RECOGNITION_MAX_EDGE), Image.Resampling.LANCZOS)
                inference_width, inference_height = source.size
                coordinate_scale_x = original_width / inference_width
                coordinate_scale_y = original_height / inference_height
                for left, top, region in _inference_regions(source, self.inference_size):
                    try:
                        results = self._predict(region)
                        for result in results:
                            boxes = getattr(result, "boxes", None)
                            if boxes is None:
                                continue
                            names = getattr(result, "names", getattr(self.model, "names", {}))
                            class_ids = boxes.cls.tolist() if getattr(boxes, "cls", None) is not None else []
                            confidences = boxes.conf.tolist() if getattr(boxes, "conf", None) is not None else []
                            coordinates = boxes.xyxy.tolist() if getattr(boxes, "xyxy", None) is not None else []
                            for index, class_id in enumerate(class_ids):
                                label = names.get(int(class_id), str(class_id)) if isinstance(names, dict) else str(class_id)
                                model_class = str(label).strip().lower().replace(" ", "_")
                                category = MODEL_CLASSES.get(model_class)
                                if category is None:
                                    continue
                                box = coordinates[index] if index < len(coordinates) else None
                                if box is not None and len(box) >= 4:
                                    box = [
                                        min(max((float(box[0]) + left) * coordinate_scale_x, 0.0), float(original_width)),
                                        min(max((float(box[1]) + top) * coordinate_scale_y, 0.0), float(original_height)),
                                        min(max((float(box[2]) + left) * coordinate_scale_x, 0.0), float(original_width)),
                                        min(max((float(box[3]) + top) * coordinate_scale_y, 0.0), float(original_height)),
                                    ]
                                candidates.append({
                                    "classId": int(class_id),
                                    "modelClass": model_class,
                                    "category": category,
                                    "confidence": float(confidences[index]) if index < len(confidences) else None,
                                    "box": box,
                                })
                    finally:
                        if region is not source:
                            region.close()
                    # ponytail: skip tiles for confident scenes; always tile if small-object recall becomes essential.
                    if region is source and candidates and all(
                        float(candidate["confidence"] or 0.0) >= FULL_IMAGE_CONFIDENCE_THRESHOLD
                        for candidate in candidates
                    ):
                        break
            finally:
                source.close()
            candidates = _deduplicate_detections(candidates)
            counts = {category: 0 for category in FRONTEND_CATEGORIES}
            detections: list[dict[str, Any]] = []
            for candidate in candidates:
                category = candidate["category"]
                counts[category] += 1
                detections.append({
                    "modelClass": candidate["modelClass"],
                    "category": category,
                    "confidence": round(float(candidate["confidence"]), 4) if candidate["confidence"] is not None else None,
                    "box": [round(float(value), 2) for value in candidate["box"]] if candidate["box"] is not None else None,
                })
            return {
                "state": "ready",
                "modelVersion": self.version,
                "counts": counts,
                "detections": detections,
                "reason": None,
            }
        except Exception as error:
            return {
                "state": "failed",
                "modelVersion": self.version,
                "counts": {category: 0 for category in FRONTEND_CATEGORIES},
                "detections": [],
                "reason": f"inference_failed:{type(error).__name__}",
            }
