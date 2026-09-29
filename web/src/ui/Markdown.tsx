import { Fragment, type ReactNode } from "react";

/**
 * Markdown SIMPLE (títulos, párrafos, listas, citas, **negrita**, *cursiva*, `código`), armado
 * como elementos de React: nunca se inserta HTML, así un texto no puede meter código en la
 * página (lo que parezca HTML se muestra como texto).
 * `headingOffset`: cuánto bajar los títulos (el `#` del documento no compite con el de la página).
 */
export function Markdown({ text, headingOffset = 1 }: { text: string; headingOffset?: number }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = Math.min(6, h[1]!.length + headingOffset);
      const Tag = `h${level}` as "h2";
      blocks.push(<Tag key={i}>{inline(h[2]!)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/).test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*(?:[-*]|\d+[.)])\s+/, ""));
        i++;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={i}>
          {items.map((it, n) => (
            <li key={n}>{inline(it)}</li>
          ))}
        </List>,
      );
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) quote.push(lines[i++]!.replace(/^>\s?/, ""));
      blocks.push(<blockquote key={i}>{inline(quote.join(" "))}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|>|\s*[-*]\s|\s*\d+[.)]\s)/.test(lines[i]!)) para.push(lines[i++]!.trim());
    blocks.push(<p key={i}>{inline(para.join(" "))}</p>);
  }
  return <>{blocks}</>;
}

/**
 * Negrita, cursiva, código y enlaces dentro de una línea (sin HTML). Un enlace sólo se arma si
 * va a https:// o a una página del sitio ("/…"); si no (javascript:, archivos), queda el texto.
 */
function inline(s: string): ReactNode {
  const parts = s.split(/(\[[^\]]+\]\([^)\s]+\)|\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g);
  return parts.map((p, n) => {
    const link = p.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const [, label, href] = link;
      if (/^\/(?!\/)/.test(href!)) return <a key={n} href={href}>{label}</a>;
      if (/^https:\/\//i.test(href!)) return <a key={n} href={href} target="_blank" rel="noopener noreferrer">{label}</a>;
      return <Fragment key={n}>{label}</Fragment>;
    }
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={n}>{p.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(p)) return <code key={n}>{p.slice(1, -1)}</code>;
    if (/^\*[^*\s][^*]*\*$/.test(p)) return <em key={n}>{p.slice(1, -1)}</em>;
    return <Fragment key={n}>{p}</Fragment>;
  });
}
