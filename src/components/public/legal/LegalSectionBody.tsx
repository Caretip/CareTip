type LegalSectionBodyProps = {
  text: string;
};

/** Renders legal copy with paragraph breaks and bullet lists (• prefix). */
export function LegalSectionBody({ text }: LegalSectionBodyProps) {
  const blocks = text.split(/\n\n+/).filter((block) => block.trim().length > 0);

  return (
    <div className="caretip-legal-document__section-body">
      {blocks.map((block) => {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        const bullets = lines.filter((line) => line.startsWith("•")).map((line) => line.replace(/^•\s*/, ""));
        const prose = lines.filter((line) => !line.startsWith("•")).join(" ").trim();

        return (
          <div key={block.slice(0, 48)} className="caretip-legal-document__block">
            {prose ? <p>{prose}</p> : null}
            {bullets.length > 0 ? (
              <ul>
                {bullets.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
