// What happened to each request, what's due, and follow-ups for a person to review and send.
// Every event comes from a person logging it. Follow-ups are written from laws.json by code, never by the model, so they can't invent law.

import { join } from "node:path";
import { die, option } from "../scripts/lib.ts";
import { loadEvents, findRequest, loadRequests, logEvent } from "./draft.ts";
import { addBusinessDays, addDays, daysBetween, deadlines, ruleFor } from "./law.ts";
import { type AppealOption, type EventType, type Home, type Law, lawById, loadLaws, loadPolicy, loadTargets, now, type Policy, type RecordsEvent, type RequesterClass, type RequestRecord, targetById, writeText } from "./lib.ts";

export interface RequestState {
  sent_at: string | null;
  klass: RequesterClass;
  agency_classified_commercial: boolean;
  acknowledged: string | null;
  estimate: string | null;
  extension_date: string | null;
  extension_reason: string | null;
  extension_over_max: boolean;
  fee_quotes: { at: string; amount: number; respond_by: string | null }[];
  fee_answered: boolean;
  clarification_open: string | null;
  denials: { at: string; exemption: string | null; note: string | null; final: boolean }[];
  partial: { at: string; count: number; exemption: string | null }[];
  received: { at: string; count: number }[];
  records_received: number;
  no_records: boolean;
  narrowed: string[];
  appeals_filed: string[];
  responded: boolean;
  closed: { at: string; outcome: string } | null;
}

export function stateOf(req: RequestRecord, events: RecordsEvent[], law: Law): RequestState {
  const s: RequestState = {
    sent_at: null, klass: law.default_class, agency_classified_commercial: false, acknowledged: null, estimate: null, extension_date: null, extension_reason: null, extension_over_max: false,
    fee_quotes: [], fee_answered: false, clarification_open: null, denials: [], partial: [], received: [], records_received: 0, no_records: false, narrowed: [], appeals_filed: [], responded: false, closed: null,
  };
  const mine = events.filter((e) => e.request_id === req.id).sort((a, b) => a.at.localeCompare(b.at));
  for (const e of mine) {
    const day = e.at.slice(0, 10);
    if (e.type === "sent") s.sent_at = day;
    if (e.type === "classified" && e.as) {
      s.klass = e.as;
      s.agency_classified_commercial = e.as === "commercial";
    }
    if (["acknowledged", "estimate", "extension", "fee_quote", "clarification_requested", "partial_grant", "records_received", "denial", "no_records"].includes(e.type)) s.responded = true;
    if (e.type === "acknowledged") {
      s.acknowledged = day;
      if (e.date) s.estimate = e.date;
    }
    if (e.type === "estimate" && e.date) s.estimate = e.date;
    if (e.type === "extension") {
      s.extension_date = e.date ?? null;
      s.extension_reason = e.note ?? null;
    }
    if (e.type === "fee_quote") {
      s.fee_quotes.push({ at: day, amount: e.amount_usd ?? 0, respond_by: e.date ?? null });
      s.fee_answered = false;
    }
    if (e.type === "fee_response") s.fee_answered = true;
    if (e.type === "clarification_requested") s.clarification_open = day;
    if (e.type === "clarification_answered") s.clarification_open = null;
    if (e.type === "narrowed") s.narrowed.push(e.note ?? day);
    if (e.type === "denial") s.denials.push({ at: day, exemption: e.exemption ?? null, note: e.note ?? null, final: e.final ?? true });
    if (e.type === "partial_grant") {
      s.partial.push({ at: day, count: e.count ?? 0, exemption: e.exemption ?? null });
      s.records_received += e.count ?? 0;
    }
    if (e.type === "records_received") {
      s.received.push({ at: day, count: e.count ?? 0 });
      s.records_received += e.count ?? 0;
    }
    if (e.type === "no_records") s.no_records = true;
    if (e.type === "appeal_filed") s.appeals_filed.push(day);
    if (e.type === "closed" || e.type === "withdrawn") s.closed = { at: day, outcome: e.outcome ?? e.type };
  }
  if (s.sent_at && s.extension_date) {
    const rule = ruleFor(law, s.klass, s.sent_at);
    const d = deadlines(law, s.klass, s.sent_at, 0);
    if (rule.extension && d.extended_max && s.extension_date > d.extended_max) s.extension_over_max = true;
  }
  return s;
}

export interface DueItem {
  request_id: string;
  target_id: string;
  kind: "first_response" | "extended_response" | "second_response" | "estimate" | "checkin" | "fee_waiting_on_you" | "clarification_waiting_on_you" | "appeal_window" | "appeal_available";
  due: string | null;
  status: "overdue" | "due_soon" | "upcoming" | "waiting_on_you" | "info";
  statutory: boolean;
  note: string;
  next: string | null;
}

function appealAvailable(a: AppealOption, s: RequestState): boolean {
  return a.requires !== "agency_classified_commercial" || s.agency_classified_commercial;
}

/** What's coming up for one request. Local holidays aren't known, so a date can run a day or so long: overdue waits out a grace day. */
export function dueItems(req: RequestRecord, events: RecordsEvent[], law: Law, policy: Policy, today: string): DueItem[] {
  const s = stateOf(req, events, law);
  if (!s.sent_at) return [];
  const items: DueItem[] = [];
  const base = { request_id: req.id, target_id: req.target_id };
  const grace = policy.tracking.overdue_grace_business_days;
  const soon = policy.tracking.due_soon_days;
  const classify = (due: string): DueItem["status"] => {
    if (addBusinessDays(due, grace) < today) return "overdue";
    return daysBetween(today, due) <= soon ? "due_soon" : "upcoming";
  };
  const d = deadlines(law, s.klass, s.sent_at, policy.tracking.checkin_no_fixed_deadline_business_days);
  const finished = !!s.closed || s.received.length > 0 || s.denials.length > 0 || s.no_records;

  if (!finished) {
    if (s.clarification_open) {
      items.push({ ...base, kind: "clarification_waiting_on_you", due: null, status: "waiting_on_you", statutory: false, note: `The agency asked you to clarify on ${s.clarification_open}. It may not act until you do.`, next: `log --id ${req.id} --event clarification_answered` });
    }
    const quote = s.fee_quotes[s.fee_quotes.length - 1];
    if (quote && !s.fee_answered) {
      items.push({ ...base, kind: "fee_waiting_on_you", due: quote.respond_by, status: "waiting_on_you", statutory: false, note: `The agency quoted $${quote.amount} on ${quote.at}. Accept, decline or narrow.`, next: `followup --id ${req.id} --kind narrowing` });
    }
    const estimated = s.estimate;
    if (estimated) {
      items.push({ ...base, kind: "estimate", due: estimated, status: classify(estimated), statutory: false, note: "The agency's own estimate.", next: `followup --id ${req.id} --kind status` });
    } else if (s.extension_date) {
      const over = s.extension_over_max ? ` That's later than the most the law allows by my count (${d.extended_max}).` : "";
      items.push({ ...base, kind: "extended_response", due: s.extension_date, status: classify(s.extension_date), statutory: true, note: `Extended by the agency${s.extension_reason ? `: ${s.extension_reason}` : ""}.${over}`, next: `followup --id ${req.id} --kind status` });
    } else if (d.first_due && !s.responded) {
      items.push({ ...base, kind: "first_response", due: d.first_due, status: classify(d.first_due), statutory: true, note: `${d.first_label} (${d.rule.first_response.cite}).${d.rule.silence === "denial" ? " Silence counts as a denial." : ` ${d.rule.silence_note}`}`, next: `followup --id ${req.id} --kind ${classify(d.first_due) === "overdue" ? "overdue" : "status"}` });
    } else if (d.checkin && !s.responded) {
      items.push({ ...base, kind: "checkin", due: d.checkin, status: classify(d.checkin), statutory: false, note: `${d.first_label}. This date is your own reminder, not a legal deadline. ${d.rule.silence_note}`, next: `followup --id ${req.id} --kind status` });
    }
    if (d.second_due && d.rule.second_response && s.acknowledged && !s.extension_date && !estimated) {
      items.push({ ...base, kind: "second_response", due: d.second_due, status: classify(d.second_due), statutory: true, note: `${d.rule.second_response.label} (${d.rule.second_response.cite}).`, next: `followup --id ${req.id} --kind status` });
    }
    // Once an agency has replied with no date, nothing else would prompt you, so the last reply starts a reminder of your own.
    const dated = items.some((i) => i.kind !== "clarification_waiting_on_you" && i.kind !== "fee_waiting_on_you");
    if (!dated && s.responded && !s.clarification_open && !(quote && !s.fee_answered)) {
      const last = events.filter((e) => e.request_id === req.id && e.type !== "followup_drafted").map((e) => e.at.slice(0, 10)).sort().pop() ?? s.sent_at;
      const due = addBusinessDays(last, policy.tracking.checkin_no_fixed_deadline_business_days);
      items.push({ ...base, kind: "checkin", due, status: classify(due), statutory: false, note: "The agency replied without giving a date. This date is your own reminder, not a legal deadline.", next: `followup --id ${req.id} --kind status` });
    }
  }

  // Appeal windows run from the denial or the last production, and they are the one date nobody else will watch for you.
  const rule = d.rule;
  const lastDenial = s.denials[s.denials.length - 1];
  const lastPartial = s.partial[s.partial.length - 1];
  if (lastDenial || lastPartial) {
    const from = [lastDenial?.at, lastPartial?.at].filter(Boolean).sort().pop()!;
    for (const a of rule.appeals) {
      if (!appealAvailable(a, s)) continue;
      if (a.window_days && a.window_unit) {
        const closes = addDays(from, a.window_days, a.window_unit);
        const left = daysBetween(today, closes);
        if (left >= 0) items.push({ ...base, kind: "appeal_window", due: closes, status: left <= 14 ? "due_soon" : "upcoming", statutory: true, note: `${a.forum} (${a.cite}). ${a.note}`, next: `followup --id ${req.id} --kind appeal` });
      } else {
        items.push({ ...base, kind: "appeal_available", due: null, status: "info", statutory: true, note: `${a.forum} (${a.cite}). No window found. ${a.note}`, next: `followup --id ${req.id} --kind appeal` });
      }
    }
  }
  return items;
}

export function dueReport(h: Home): void {
  const today = now().toISOString().slice(0, 10);
  const events = loadEvents(h);
  const laws = loadLaws(h);
  const policy = loadPolicy(h);
  const items = loadRequests(h).flatMap((r) => dueItems(r, events, lawById(laws, r.law_id), policy, today));
  console.log(`As of ${today}${h.dataset === "test" ? " (FICTIONAL TEST DATA)" : ""}. Federal holidays are counted, but state and local ones aren't, so real dates can run a day or so later.\n`);
  if (!items.length) return void console.log("Nothing due. Sent requests appear here once you log them.");
  const order = ["overdue", "waiting_on_you", "due_soon", "upcoming", "info"];
  for (const status of order) {
    const group = items.filter((i) => i.status === status).sort((a, b) => (a.due ?? "9").localeCompare(b.due ?? "9"));
    if (!group.length) continue;
    console.log(`${status.toUpperCase().replace(/_/g, " ")}`);
    for (const i of group) console.log(`  ${i.due ?? "no date"}  ${i.request_id}  ${i.target_id}  ${i.kind}${i.statutory ? "" : " (not statutory)"}\n    ${i.note}${i.next ? `\n    Next: ${i.next}` : ""}`);
  }
}

const EVENTS: EventType[] = ["sent", "acknowledged", "estimate", "extension", "classified", "clarification_requested", "clarification_answered", "fee_quote", "fee_response", "narrowed", "partial_grant", "records_received", "denial", "no_records", "appeal_filed", "appeal_decided", "withdrawn", "closed"];

/** Logs what a person did or what an agency replied. The sent date is only ever recorded here, by a person. */
export function logOutcome(h: Home): void {
  const req = findRequest(h, option("id"));
  const type = option("event") as EventType;
  if (!EVENTS.includes(type)) die(`--event must be one of: ${EVENTS.join(", ")}`);
  const events = loadEvents(h);
  const mine = events.filter((e) => e.request_id === req.id);
  const day = option("on") ?? option("date");
  const date = option("due");
  if (type === "sent") {
    if (!mine.some((e) => e.type === "approved")) die(`${req.id} was never approved. Review and approve it first. If it already went out, that skipped the checkpoint, so read the sent text against the rules.`);
    if (mine.some((e) => e.type === "sent")) die(`${req.id} is already logged as sent.`);
    if (!option("date")) die("Give --date YYYY-MM-DD, the day you sent it. The agent never assumes it.");
  } else if (!mine.some((e) => e.type === "sent")) {
    die(`${req.id} hasn't been logged as sent, so nothing can have happened to it yet.`);
  }
  if (type === "denial" && !option("exemption")) console.log("Note: no --exemption given. If the agency cited one, log it, because the learning step can't read what you don't log.");
  if (type === "fee_quote" && option("amount") === undefined) die("Give --amount for a fee quote.");
  if (type === "classified" && !option("as")) die("Give --as commercial or noncommercial.");
  if (type === "estimate" && !date) die("Give --due YYYY-MM-DD, the agency's estimated date.");
  if (type === "extension" && !date) die("Give --due YYYY-MM-DD, the date the agency gave.");
  if ((type === "records_received" || type === "partial_grant") && option("count") === undefined) die("Give --count, the number of documents received. Usable records are counted later, at intake.");
  logEvent(h, {
    type,
    request_id: req.id,
    at: day ? new Date(`${day}T12:00:00.000Z`).toISOString() : undefined,
    date,
    note: option("note"),
    channel: option("channel"),
    as: option("as") as RequesterClass | undefined,
    amount_usd: option("amount") !== undefined ? Number(option("amount")) : undefined,
    count: option("count") !== undefined ? Number(option("count")) : undefined,
    exemption: option("exemption"),
    final: option("final") !== undefined ? option("final") === "true" : undefined,
    outcome: option("outcome"),
  });
  console.log(`✓ Logged ${type} on ${req.id}.`);
}

type FollowupKind = "status" | "overdue" | "narrowing" | "appeal";

/** Drafts one follow-up as a text file for a person to review. Nothing here says anyone broke the law, and appeal options are options, not advice. */
export function followupText(req: RequestRecord, s: RequestState, law: Law, kind: FollowupKind, agency: string, today: string, sentenceNarrow: string | null): string {
  const sent = s.sent_at ?? "[date sent]";
  const fic = req.dataset === "test" ? "FICTIONAL TEST DATA. Not a real request. Nobody receives this.\n\n" : "";
  const sign = "\nThank you.\n\n[Your full name]\n[Email]\n[Phone]";
  if (kind === "status" || kind === "overdue") {
    const d = deadlines(law, s.klass, sent, 0);
    const cite = d.rule.first_response.cite;
    const opening = kind === "overdue" ? `I'm following up on my request sent ${sent}. By my count, a response under ${cite} would have been due around ${d.first_due}. I may have that date wrong, and I know these take time.` : `I'm following up on my request sent ${sent}.`;
    return `${fic}Subject: Following up: ${req.subject}\n\nHello,\n\n${opening}\n\nCould you tell me where it stands, and when you expect to respond? If something about the request is holding it up, I'm glad to narrow it.\n${sign}`;
  }
  if (kind === "narrowing") {
    const quote = s.fee_quotes[s.fee_quotes.length - 1];
    const about = quote ? `Thanks for the estimate of $${quote.amount}.` : "Thanks for getting back to me.";
    return `${fic}Subject: Narrowing: ${req.subject}\n\nHello,\n\n${about} To make this easier and less costly, I'd like to narrow the request. I'd be glad to ${sentenceNarrow ?? "[the smaller version you want]"}\n\nCould you tell me whether that works, and what it would cost?\n${sign}`;
  }
  const rule = ruleFor(law, s.klass, sent);
  const lastDenial = s.denials[s.denials.length - 1];
  const options = rule.appeals.map((a) => {
    const available = appealAvailable(a, s);
    const from = lastDenial?.at ?? s.partial[s.partial.length - 1]?.at ?? today;
    const window = a.window_days && a.window_unit ? `Window: closes around ${addDays(from, a.window_days, a.window_unit)}.` : "Window: none found. Don't assume there's no limit.";
    return `- ${a.forum} (${a.cite})${available ? "" : " NOT OPEN to this request as classified"}. ${window} ${a.note}`;
  });
  return `${fic}NOT A LETTER. Appeal options for ${agency}, for you and a lawyer. This isn't legal advice.\n\nRequest: ${req.subject}, sent ${sent}.\nDenial: ${lastDenial ? `${lastDenial.at}, exemption ${lastDenial.exemption ?? "not logged"}. ${lastDenial.note ?? ""}` : "none logged"}\nRequester class: ${s.klass}.\n${law.denial_content ?? ""}\n\nOptions:\n${options.join("\n")}\n\nBefore appealing, consider asking the agency to narrow or release a redacted version. It's usually faster, and it doesn't stop you appealing unless a window closes.\n`;
}

export function followup(h: Home): void {
  const req = findRequest(h, option("id"));
  const kind = option("kind") as FollowupKind;
  if (!["status", "overdue", "narrowing", "appeal"].includes(kind)) die("--kind must be status, overdue, narrowing or appeal.");
  const law = lawById(loadLaws(h), req.law_id);
  const s = stateOf(req, loadEvents(h), law);
  if (!s.sent_at) die(`${req.id} hasn't been logged as sent.`);
  const target = targetById(loadTargets(h), req.target_id);
  const ask = target.asks.find((a) => a.key === req.ask_key);
  const today = now().toISOString().slice(0, 10);
  const text = followupText(req, s, law, kind, target.agency, today, ask?.narrowing ? ask.narrowing.replace(/^.*?(?:I would gladly|I'd gladly) /i, "") : null);
  const path = join(h.followups, `${req.id}-${kind}-${today}.txt`);
  writeText(path, `YOU REVIEW AND SEND THIS, if at all. Nothing here sends it.\n\n-----\n\n${text}`);
  logEvent(h, { type: "followup_drafted", request_id: req.id, note: kind });
  console.log(`✓ ${path}\n\n${text}`);
}
