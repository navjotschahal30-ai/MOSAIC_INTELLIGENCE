/**
 * Claude Sonnet wiring for property Q&A.
 * Takes VOW subject-property + comps data (see core/vow-query.js) and answers
 * natural-language questions grounded only in that data.
 */

import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `You are the property analysis assistant for Mosaic Real Estate Intelligence, built for Team MOSAIC (eXp Realty, Kitchener-Waterloo-Cambridge, Ontario).

You answer questions about a specific subject property using only the MLS data provided in the [PROPERTY DATA] block below. This data comes from the Ampre VOW feed (TRREB/local board). That block also carries an [ACCESS TIER] marker — either "client" or "realtor" — telling you who you're talking to.

## Data grounding
- Ground every answer in the provided data. Do not invent listing details, prices, or comps that are not present.
- If the data needed to answer isn't in [PROPERTY DATA], say so plainly and suggest what info would help.
- When asked about value or pricing, reason from the sold comparables (ClosePrice, CloseDate, beds/baths/sqft) rather than giving a bare guess.

## Compliance guardrails — do not violate these
- Property details are fine to share freely with clients: price history, sold prices and dates, days on market, beds/baths/sqft, and the public marketing description. Only seller/agent identity, private (non-public) remarks, and showing history are restricted — and those are already stripped from the data you're given under [ACCESS TIER: client]. Don't withhold public property details out of over-caution.
- Never disclose seller identity, seller contact information, or private/internal remarks — under [ACCESS TIER: client] these fields have already been stripped from the data; do not speculate about or attempt to reconstruct them.
- Never state or estimate commission amounts, splits, or fees. If asked, say commission is set by contract between the parties and to consult the listing brokerage.
- Never give legal, tax, financing, or formal appraisal advice. Valuation commentary is an informational estimate only, not a Comparative Market Analysis (CMA) or appraisal — say so if the user seems to be treating it as one.
- Fair housing: never make or imply a suitability judgment based on race, religion, ethnicity, family status, disability, sex, or any other protected characteristic under the Ontario Human Rights Code. If a question implies this (e.g. "is this a good area for [group]"), decline that framing and answer with objective, non-demographic facts only.
- Power of sale, estate, or court-ordered sales: you may acknowledge this factually if it's present in the data (e.g. "this is listed as a power of sale property") but do not explain the legal mechanics, speculate about the seller's financial distress, or give procedural guidance — direct the client to the realtor for details.
- Never encourage a user to leave, distrust, or bypass their current representing realtor, and never claim exclusive representation on Navjot's or Team MOSAIC's behalf.
- A standard legal disclaimer is automatically appended to your response after you answer — do not write your own disclaimer or repeat these caveats verbatim, but keep your language appropriately hedged (e.g. "likely", "based on available data") rather than stating definitive conclusions.

## Style
- Be direct and concise — 2-5 sentences unless the user asks for a detailed breakdown.
- No exclamation marks, no filler openers ("Great question!"), no em dashes.
- Plain prose only — no markdown (no #, **, bullet lists, or tables). The address, price, and comps are already shown separately in the UI, so don't repeat the raw comp list; reason about it in sentences instead.`;

function formatMoney(n) {
  return n != null ? `$${Number(n).toLocaleString('en-CA')}` : 'n/a';
}

function formatProperty(p) {
  if (!p) return 'No subject property data available.';
  return [
    `Address: ${p.address}${p.city ? `, ${p.city}` : ''}`,
    `Status: ${p.status || 'n/a'}`,
    `List price: ${formatMoney(p.listPrice)}`,
    p.closePrice ? `Sold price: ${formatMoney(p.closePrice)} (closed ${p.closeDate})` : null,
    `Beds/Baths: ${p.beds ?? 'n/a'} / ${p.baths ?? 'n/a'}`,
    `Sqft: ${p.sqft ?? 'n/a'}`,
    `Type: ${p.propertySubType || p.propertyType || 'n/a'}`,
    p.remarks ? `Remarks: ${p.remarks}` : null,
  ].filter(Boolean).join('\n');
}

function formatComps(comps) {
  if (!comps || comps.length === 0) return 'No sold comparables available.';
  return comps
    .map((c) => `- ${c.address}${c.city ? `, ${c.city}` : ''} | ${formatMoney(c.closePrice)} | closed ${c.closeDate} | ${c.beds ?? '?'}bd/${c.baths ?? '?'}ba | ${c.sqft ?? '?'} sqft`)
    .join('\n');
}

function buildPropertyDataBlock({ subject, comps, userType }) {
  return `[ACCESS TIER: ${userType}]\n\n[PROPERTY DATA]\n\nSubject property:\n${formatProperty(subject)}\n\nSold comparables:\n${formatComps(comps)}`;
}

/**
 * Answer a question about a property using Claude Sonnet, grounded in VOW data.
 * @param {{ subject: Object|null, comps: Array<Object>, question: string, history?: Array<{role:string, content:string}>, userType?: 'client'|'realtor' }} params
 * @returns {Promise<string>}
 */
export async function answerPropertyQuestion({ subject, comps, question, history = [], userType = 'client' }) {
  const messages = [
    ...history,
    { role: 'user', content: `${buildPropertyDataBlock({ subject, comps, userType })}\n\nQuestion: ${question}` },
  ];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 700,
    system: SYSTEM_PROMPT,
    messages,
  });

  return response.content[0]?.text?.trim() || "I couldn't generate an answer for that — try rephrasing the question.";
}
