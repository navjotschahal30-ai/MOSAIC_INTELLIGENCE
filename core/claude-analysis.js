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

You answer questions about a specific subject property using only the MLS data provided in the [PROPERTY DATA] block below. This data comes from the Ampre VOW feed (TRREB).

Rules:
- Ground every answer in the provided data. Do not invent listing details, prices, or comps that are not present.
- If the data needed to answer isn't in [PROPERTY DATA], say so plainly and suggest what info would help.
- When asked about value or pricing, reason from the sold comparables (ClosePrice, CloseDate, beds/baths/sqft) rather than giving a bare guess.
- Be direct and concise — 2-5 sentences unless the user asks for a detailed breakdown.
- No exclamation marks, no filler openers ("Great question!"), no em dashes.`;

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

function buildPropertyDataBlock({ subject, comps }) {
  return `[PROPERTY DATA]\n\nSubject property:\n${formatProperty(subject)}\n\nSold comparables:\n${formatComps(comps)}`;
}

/**
 * Answer a question about a property using Claude Sonnet, grounded in VOW data.
 * @param {{ subject: Object|null, comps: Array<Object>, question: string, history?: Array<{role:string, content:string}> }} params
 * @returns {Promise<string>}
 */
export async function answerPropertyQuestion({ subject, comps, question, history = [] }) {
  const messages = [
    ...history,
    { role: 'user', content: `${buildPropertyDataBlock({ subject, comps })}\n\nQuestion: ${question}` },
  ];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 700,
    system: SYSTEM_PROMPT,
    messages,
  });

  return response.content[0]?.text?.trim() || "I couldn't generate an answer for that — try rephrasing the question.";
}
