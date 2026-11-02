// Short, printable codes for class/subclass names, used on reports where space is
// tight (e.g. the fee defaulter letters correction list). Keeps the mapping in one
// place rather than re-deriving it ad hoc in every report script.
//
// Examples: FORM 1 + "FORM 1 MN" -> "F1MN"; LOWER SIXTH ARTS + "LOWER SIXTH A1" -> "LSA1";
// UPPER SIXTH SCIENCE + "UPPER SIXTH S2" -> "USS2".

const FORM_RE = /^FORM\s*(\d+)/i;
const SIXTH_RE = /^(LOWER|UPPER)\s+SIXTH\s+(ARTS|SCIENCE)/i;

export function abbreviateClassName(className?: string | null, subClassName?: string | null): string {
    const cls = (className || '').trim().toUpperCase();
    const sub = (subClassName || '').trim().toUpperCase();

    const formMatch = cls.match(FORM_RE);
    if (formMatch) {
        const base = `F${formMatch[1]}`;
        const suffix = sub.replace(FORM_RE, '').replace(/\s+/g, '').trim();
        return suffix ? `${base}${suffix}` : base;
    }

    const sixthMatch = cls.match(SIXTH_RE);
    if (sixthMatch) {
        const level = sixthMatch[1] === 'LOWER' ? 'L' : 'U';
        const stream = sixthMatch[2] === 'ARTS' ? 'A' : 'S';
        const base = `${level}S${stream}`; // LSA, LSS, USA, USS
        const digits = (sub.match(/(\d+)\s*$/) || [])[1];
        return digits ? `${base}${digits}` : base;
    }

    // Unknown naming convention -- fall back to a compacted subclass (or class) name
    // rather than guessing at a scheme.
    return (sub || cls).replace(/\s+/g, '');
}
