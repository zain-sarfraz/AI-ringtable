import { applyBranchOrdering, appendPlaceOrderToolContract } from "./restaurantVoiceContext.js";

export class PromptMergeError extends Error {
  constructor(message, code = "PROMPT_MERGE_ERROR") {
    super(message);
    this.name = "PromptMergeError";
    this.code = code;
  }
}

const CRITICAL_MARKERS = [
  { re: /PRIMARY MISSION/i, label: "PRIMARY MISSION" },
  { re: /## Branch ordering\b/i, label: "## Branch ordering" },
  { re: /## PLACE_ORDER TOOL CONTRACT/i, label: "## PLACE_ORDER TOOL CONTRACT" },
  { re: /CASH ONLY|Payment is CASH|Cash on Delivery|\bCOD\b/i, label: "payment rules" },
];

export function promptHasMenuKnowledge(text) {
  return /# .+ — Menu/m.test(String(text || "")) || /## Menu Categories/i.test(String(text || ""));
}

/**
 * Rewrite stale keyword-style confirmation + leftover COD / branch-ask lines in saved prompts.
 * Keeps custom conversation rules; only patches known bad templates.
 */
export function rewriteStaleOrderSpeechRules(prompt, branchCount = 0) {
  let text = String(prompt || "");

  text = text.replace(
    /Confirm FAST \(do not drag\): "Aapka order: \[qty\] \[item\], \[naam\], \[delivery \/ pickup\], teks shamil karke kul raqam \[English AFTER-TAX total e\.g\. five hundred forty [^\"]+\] hai\. Kya main yeh order confirm kar doon\?" Then WAIT — on haan call place_order immediately\. NEVER say daraj\/darj\/rupay\./gi,
    'Confirm FAST in natural sentences (NOT keyword lists): "Aapka order yeh hai: [qty] [item]. Yeh order [EXACT naam] ke naam par hai, [delivery / pickup] ke liye. Teks shamil karke kul bill [English AFTER-TAX total] rupees bana hai. Kya main yeh order confirm kar doon?" Then WAIT — on haan call place_order immediately. NEVER say daraj/darj/rupay.',
  );

  text = text.replace(
    /"Aapka order: \[quantity\] \[item name\], \[naam\], \[delivery ya pickup\], \[pata\], teks shamil karke kul raqam \[e\.g\. five hundred forty\] ([^"]+) hai\. Kya main yeh order confirm kar doon\?"/gi,
    '"Aapka order yeh hai: [quantity] [item name]. Yeh order [EXACT naam] ke naam par hai, [delivery ya pickup] ke liye. Teks shamil karke kul bill [e.g. five hundred forty three] $1 bana hai. Kya main yeh order confirm kar doon?"',
  );

  text = text.replace(
    /10\. Payment is COD — never ask how they will pay\./g,
    '10. Payment is CASH ONLY — never ask how they will pay. Delivery: cash at delivery. Pickup: cash at pickup.',
  );

  if (Number(branchCount) === 0) {
    text = text.replace(
      /8\. Branch ordering section overrides location questions\. No branches → never ask area; branch_name = none\./g,
      "8. Branch ordering section overrides location questions. No branches → never ask area/city/branch and NEVER say Johar Town or Iqbal Town; branch_name = none.",
    );
    text = text.replace(
      /11\. After the caller says haan, call place_order once immediately\. Do not speak a waiting line\./g,
      '11. After haan: call place_order ONCE immediately with branch_name "none". Do NOT ask Johar Town / Iqbal Town / area after haan. Do not speak a waiting line.',
    );
    if (!/AFTER HAAN — NO BRANCH ASK/i.test(text)) {
      const guard = `
=======================================================
AFTER HAAN — NO BRANCH ASK (CRITICAL):
- ## Branch ordering says this restaurant has NO branches.
- After the caller says haan/yes: call place_order immediately with branch_name exactly "none".
- FORBIDDEN after haan: asking Johar Town, Iqbal Town, city, area, or branch — even if a tool error mentions areas.
- If a tool says branch_required: retry place_order with branch_name "none". Do NOT ask the caller.
=======================================================
`;
      const turn1 = text.search(/\nTurn 1:/);
      if (turn1 !== -1) {
        text = `${text.slice(0, turn1)}\n${guard}${text.slice(turn1)}`;
      } else {
        text = `${text.trim()}\n${guard}`;
      }
    }
  }

  return text;
}

/** Remove an existing place_order contract block so it can be refreshed in place. */
export function stripPlaceOrderToolContract(prompt) {
  return String(prompt || "")
    .replace(
      /\n?={3,}[^\n]*\n## PLACE_ORDER TOOL CONTRACT[\s\S]*?(?:\n={3,}[^\n]*\n?|(?=\n## )|$)/gi,
      "\n",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Always end with the current place_order contract (replace if present, else append). */
export function ensurePlaceOrderToolContract(prompt, lang = "ur") {
  const stripped = stripPlaceOrderToolContract(prompt);
  return appendPlaceOrderToolContract(stripped, lang);
}

/**
 * Replace the menu/knowledge block (`# Name — Menu…`) while keeping conversation rules above it.
 */
export function replaceMenuKnowledgeBlock(prompt, knowledge) {
  const text = String(prompt || "");
  const block = String(knowledge || "").trim();
  if (!block) return text.trim();

  const startRe = /^# .+ — Menu[^\n]*/m;
  const match = startRe.exec(text);
  if (!match) {
    if (/## Menu Categories/i.test(text)) {
      const cat = /^## Menu Categories[^\n]*/im.exec(text);
      if (cat) {
        const start = cat.index;
        const after = text.slice(start);
        const contractRel = after.search(/\n={3,}[\s\S]*?## PLACE_ORDER TOOL CONTRACT/i);
        const end = contractRel === -1 ? text.length : start + contractRel;
        return `${text.slice(0, start).trimEnd()}\n\n${block}${text.slice(end)}`.trim();
      }
    }
    return `${text.trim()}\n\n${block}`.trim();
  }

  const start = match.index;
  const after = text.slice(start);
  const contractRel = after.search(/\n={3,}[\s\S]*?## PLACE_ORDER TOOL CONTRACT/i);
  const end = contractRel === -1 ? text.length : start + contractRel;
  return `${text.slice(0, start).trimEnd()}\n\n${block}${text.slice(end)}`.trim();
}

/**
 * Detect a short/partial frontend payload that would wipe a rich saved prompt.
 */
export function isPartialPromptOverwrite(saved, incoming) {
  const s = String(saved || "").trim();
  const i = String(incoming || "").trim();
  if (!s || !i) return false;
  if (i.length >= s.length * 0.7) return false;

  const savedMarkers = CRITICAL_MARKERS.filter((m) => m.re.test(s));
  if (!savedMarkers.length) {
    return i.length < 200 && s.length > 1000;
  }
  const missing = savedMarkers.filter((m) => !m.re.test(i));
  if (missing.length >= 2) return true;
  if (missing.length >= 1 && i.length < s.length * 0.5) return true;
  return false;
}

function syncedAtMs(value) {
  if (value == null || value === "") return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Resolve the prompt to send to Synthflow without silently wiping saved instructions.
 *
 * @param {object} opts
 * @param {string|null|undefined} opts.incoming - Prompt from the frontend editor (may be empty)
 * @param {string|null|undefined} opts.saved - Latest DB / backend prompt (source of truth)
 * @param {boolean} [opts.replaceFull=false] - Explicit full replace with incoming text
 * @param {boolean} [opts.refreshKnowledge=true] - Refresh menu/knowledge from catalog
 * @param {string} [opts.knowledge] - Fresh knowledge from buildRestaurantVoiceKnowledge
 * @param {array} [opts.branches]
 * @param {string} [opts.language]
 * @param {() => string} [opts.defaultPromptBuilder] - Used only when nothing is saved
 * @param {string|null} [opts.expectedSyncedAt] - Client's last known synthflow_synced_at
 * @param {string|null} [opts.currentSyncedAt] - DB synthflow_synced_at
 * @returns {string}
 */
export function resolveSynthflowPromptUpdate({
  incoming,
  saved,
  replaceFull = false,
  refreshKnowledge = true,
  knowledge = "",
  branches = [],
  language = "ur",
  defaultPromptBuilder,
  expectedSyncedAt = null,
  currentSyncedAt = null,
} = {}) {
  const expectedMs = syncedAtMs(expectedSyncedAt);
  const currentMs = syncedAtMs(currentSyncedAt);
  if (expectedMs != null && currentMs != null && expectedMs !== currentMs) {
    throw new PromptMergeError(
      "Prompt was updated elsewhere since you loaded this page. Reload the settings, then try again.",
      "STALE_PROMPT_UPDATE",
    );
  }

  const incomingTrim = String(incoming ?? "").trim();
  const savedTrim = String(saved ?? "").trim();
  const wantReplace = Boolean(replaceFull);

  let base;
  if (wantReplace) {
    if (!incomingTrim) {
      throw new PromptMergeError(
        "Replace full prompt requires a non-empty system prompt. Paste the complete prompt, or turn off Replace full prompt.",
        "REPLACE_REQUIRES_PROMPT",
      );
    }
    base = incomingTrim;
  } else if (!incomingTrim) {
    // Empty/missing frontend field must never clear the saved prompt.
    if (savedTrim) {
      base = savedTrim;
    } else if (typeof defaultPromptBuilder === "function") {
      base = String(defaultPromptBuilder() || "").trim();
    } else {
      throw new PromptMergeError(
        "No saved agent prompt is available to update. Reload settings or provide a full system prompt.",
        "PROMPT_UNAVAILABLE",
      );
    }
  } else {
    if (savedTrim && isPartialPromptOverwrite(savedTrim, incomingTrim)) {
      throw new PromptMergeError(
        "Incoming prompt is missing required sections that exist in the saved prompt (e.g. branch, payment, or place_order rules). Load the full prompt in the editor, or enable Replace full prompt only if you intend to overwrite everything.",
        "AMBIGUOUS_PARTIAL_PROMPT",
      );
    }
    base = incomingTrim;
  }

  if (!base) {
    throw new PromptMergeError("Resolved agent prompt is empty.", "EMPTY_PROMPT");
  }

  let merged = base;
  const knowledgeTrim = String(knowledge || "").trim();
  if (refreshKnowledge && knowledgeTrim) {
    if (promptHasMenuKnowledge(merged)) {
      merged = replaceMenuKnowledgeBlock(merged, knowledgeTrim);
    } else {
      merged = `${merged.trim()}\n\n${knowledgeTrim}`;
    }
  }

  const branchList = branches || [];
  merged = rewriteStaleOrderSpeechRules(merged, branchList.length);
  merged = applyBranchOrdering(merged, branchList);
  merged = ensurePlaceOrderToolContract(merged, language);

  if (!String(merged || "").trim()) {
    throw new PromptMergeError("Merged agent prompt is empty after applying sections.", "EMPTY_PROMPT");
  }

  // Soft validation: if the saved prompt had cash/branch markers, the merge must keep them.
  if (savedTrim) {
    const hadCash = /CASH ONLY|Payment is CASH|Cash on Delivery|\bCOD\b|payment/i.test(savedTrim);
    const hasCash = /CASH ONLY|Payment is CASH|Cash on Delivery|\bCOD\b|Payment: CASH/i.test(merged);
    if (hadCash && !hasCash) {
      throw new PromptMergeError(
        "Merged prompt lost payment rules. Update aborted to protect cash-only configuration.",
        "LOST_PAYMENT_RULES",
      );
    }
    if (/## Branch ordering\b/i.test(savedTrim) && !/## Branch ordering\b/i.test(merged)) {
      throw new PromptMergeError(
        "Merged prompt lost ## Branch ordering. Update aborted.",
        "LOST_BRANCH_SECTION",
      );
    }
  }

  if (!/## PLACE_ORDER TOOL CONTRACT/i.test(merged)) {
    throw new PromptMergeError(
      "Merged prompt is missing the place_order contract. Update aborted.",
      "LOST_PLACE_ORDER_CONTRACT",
    );
  }

  return merged.trim();
}
