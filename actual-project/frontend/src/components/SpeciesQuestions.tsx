import { useEffect, useRef, useState } from "react";
import { askSpeciesQuestion } from "../api";
import { Sheet, SummaryCard } from "./CoastalUI";
import { PrimaryButton } from "./ui";
import { actionTitle } from "../presentation";

type SpeciesGuide = {
  id: string;
  answers: { title: string; text: string }[];
  sources: { label: string; url: string }[];
};
type Reply = { question: string; text: string; custom: boolean; loading?: boolean; error?: boolean };
const QUESTIONS = ["Where does it usually live?", "How can marine litter affect it?", "What can I do?"];

export function SpeciesQuestions({ species }: { species: SpeciesGuide }) {
  const [question, setQuestion] = useState("");
  const [reply, setReply] = useState<Reply | null>(null);
  const sequence = useRef(0);
  useEffect(() => () => { sequence.current += 1; }, []);
  const close = () => { sequence.current += 1; setReply(null); };
  const ask = async (text: string) => {
    const current = ++sequence.current;
    setReply({ question: text, text: "", custom: true, loading: true });
    try {
      const result = await askSpeciesQuestion(species.id, text);
      if (current === sequence.current) setReply({ question: text, text: result.answer, custom: true });
    } catch (error) {
      if (current === sequence.current) setReply({ question: text, text: error instanceof Error ? error.message : "AI could not answer. Please try again.", custom: true, error: true });
    }
  };
  return <>
    <SummaryCard eyebrow="Ask AI">
      <p className="species-question-note">Choose a published answer, or ask AI your own question.</p>
      {QUESTIONS.map((text, index) => <button key={text} className="coastal-link-row" onClick={() => {
        sequence.current += 1;
        setReply({ question: text, text: species.answers[index].text, custom: false });
      }}>
        <span className="grow" style={{ fontSize: 14, fontWeight: 650 }}>{actionTitle(text)}</span><span>→</span>
      </button>)}
      <form onSubmit={event => { event.preventDefault(); if (question.trim() && !reply?.loading) void ask(question.trim()); }}>
        <label htmlFor="species-custom-question">Your own question</label>
        <textarea id="species-custom-question" className="coastal-input" rows={3} maxLength={500} value={question} onChange={event => setQuestion(event.target.value)} placeholder="What would you like to know about this species?" />
        <button className="species-question-submit" type="submit" disabled={!question.trim() || reply?.loading}>Ask AI →</button>
      </form>
    </SummaryCard>
    {reply && <Sheet title={reply.question} onClose={close} className="species-qa-sheet">
      <p className="coastal-footnote">{reply.custom ? "AI-generated · species knowledge" : "From this guide’s published sources"}</p>
      <div aria-live="polite" role={reply.error ? "alert" : "status"}>
        {reply.loading ? <p>Preparing your answer…</p> : <p className="species-qa-answer" style={{ whiteSpace: "pre-wrap" }}>{reply.text}</p>}
      </div>
      {reply.error && <PrimaryButton onClick={() => void ask(reply.question)}>Try again</PrimaryButton>}
      {reply.custom && !reply.loading && !reply.error && <p className="coastal-footnote">Species guide references</p>}
      {!reply.loading && !reply.error && species.sources.map(source => <a key={source.url} className="species-source" href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>)}
    </Sheet>}
  </>;
}
