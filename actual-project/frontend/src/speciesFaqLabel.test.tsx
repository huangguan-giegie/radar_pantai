import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpeciesQuestions } from "./components/SpeciesQuestions";
import { askSpeciesQuestion } from "./api";
import content from "./content/coastalContent.json";

vi.mock("./api", () => ({ askSpeciesQuestion: vi.fn() }));
vi.mock("./components/CoastalUI", () => ({
  SummaryCard: ({ children }: any) => <section>{children}</section>,
  Sheet: ({ title, children, onClose }: any) => <section role="dialog"><h2>{title}</h2>{children}<button onClick={onClose}>Close</button></section>,
}));
const species = content.species.find(s => s.id === "dugong")!;
let view: ReactTestRenderer;
afterEach(() => { if (view) act(() => view.unmount()); vi.resetAllMocks(); });
const html = () => JSON.stringify(view.toJSON());
function render() { act(() => { view = create(<SpeciesQuestions species={species} />); }); }
function nodeText(node: ReactTestInstance | string): string { return typeof node === "string" ? node : node.children.map(nodeText).join(""); }
function button(text: string) { return view.root.findAllByType("button").find(b => nodeText(b).includes(text))!; }
function enter(text: string) { act(() => view.root.findByType("textarea").props.onChange({ target: { value: text } })); }
async function submit() { await act(async () => view.root.findByType("form").props.onSubmit({ preventDefault() {} })); }

describe("species questions", () => {
  it("hides prepared answers until clicked and never calls AI for the first three questions", () => {
    render();
    expect(view.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
    expect(view.root.findByType("textarea").props.value).toBe("");
    for (const [index, label] of ["Where does", "How can", "What can"].entries()) {
      act(() => button(label).props.onClick());
      expect(html()).toContain(species.answers[index].text);
      expect(html()).toContain("published sources");
      act(() => button("Close").props.onClick());
      expect(html()).not.toContain(species.answers[index].text);
    }
    expect(askSpeciesQuestion).not.toHaveBeenCalled();
  });
  it("only sends a non-empty custom question to AI and displays the answer", async () => {
    vi.mocked(askSpeciesQuestion).mockResolvedValue({ answer: "A grounded custom answer." });
    render();
    expect(button("Ask AI").props.disabled).toBe(true);
    enter("  What does a dugong eat?  ");
    await submit();
    expect(askSpeciesQuestion).toHaveBeenCalledExactlyOnceWith("dugong", "What does a dugong eat?");
    expect(html()).toContain("A grounded custom answer.");
    expect(html()).toContain("AI-generated");
  });
  it("shows a failed request with a working retry", async () => {
    vi.mocked(askSpeciesQuestion).mockRejectedValueOnce(new Error("AI is busy.")).mockResolvedValueOnce({ answer: "Retry answer." });
    render(); enter("What can I do?"); await submit();
    expect(html()).toContain("AI is busy.");
    await act(async () => button("Try Again").props.onClick());
    expect(html()).toContain("Retry answer.");
    expect(askSpeciesQuestion).toHaveBeenCalledTimes(2);
  });
  it("does not reopen an answer dismissed while AI was loading", async () => {
    let resolve!: (value: { answer: string }) => void;
    vi.mocked(askSpeciesQuestion).mockReturnValue(new Promise(done => { resolve = done; }));
    render(); enter("Tell me about dugongs."); await submit();
    expect(html()).toContain("Preparing your answer");
    act(() => button("Close").props.onClick());
    await act(async () => resolve({ answer: "Late answer." }));
    expect(view.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
  });
});
