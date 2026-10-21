"""Prompt builder for the AI Voice Sales Bot (F02).

Builds the system prompt and sales flow from config/product.yaml.
Enforces spoken-style constraints: short replies, no markdown, no invented content.
"""

import re
from typing import Any

from app.config import PRODUCT


def build_system_prompt() -> str:
    """Assemble the complete system prompt from product.yaml.

    Returns a single string containing product identity, pitch, features,
    pricing, FAQs, objection handling, CTAs, demo booking, and rules.
    """
    product = PRODUCT.get("product", {})
    pitch = PRODUCT.get("pitch", "")
    features = PRODUCT.get("features", [])
    pricing = PRODUCT.get("pricing", [])
    faqs = PRODUCT.get("faqs", [])
    objections = PRODUCT.get("objection_handling", [])
    ctas = PRODUCT.get("ctas", {})
    demo_booking = PRODUCT.get("demo_booking", {})
    rules = PRODUCT.get("rules", [])

    parts = []

    # Identity
    name = product.get("name", "Our Product")
    tagline = product.get("tagline", "")
    description = product.get("description", "")
    target_buyer = product.get("target_buyer", "")

    parts.append(f"You are a sales representative for {name}.")
    if tagline:
        parts.append(f"Tagline: {tagline}")
    if description:
        parts.append(f"Description: {description}")
    if target_buyer:
        parts.append(f"Target buyer: {target_buyer}")

    # Pitch
    if pitch:
        parts.append(f"\nOpening pitch: {pitch.strip()}")

    # Features
    if features:
        parts.append("\nFeatures:")
        for f in features:
            fname = f.get("name", "")
            benefit = f.get("benefit", "")
            if fname:
                parts.append(f"  - {fname}: {benefit}")

    # Pricing
    if pricing:
        parts.append("\nPricing tiers:")
        for tier in pricing:
            tname = tier.get("name", "")
            price = tier.get("price", "")
            tfeatures = tier.get("features", [])
            cta = tier.get("cta", "")
            if tname:
                parts.append(f"  {tname}: {price}")
                if tfeatures:
                    parts.append(f"    Includes: {', '.join(tfeatures)}")
                if cta:
                    parts.append(f"    CTA: {cta}")

    # FAQs
    if faqs:
        parts.append("\nFrequently asked questions:")
        for q in faqs:
            question = q.get("question", "")
            answer = q.get("answer", "")
            if question and answer:
                parts.append(f"  Q: {question}")
                parts.append(f"  A: {answer}")

    # Objection handling
    if objections:
        parts.append("\nObjection handling:")
        for obj in objections:
            objection = obj.get("objection", "")
            response = obj.get("response", "")
            if objection and response:
                parts.append(f"  If they say: \"{objection}\"")
                parts.append(f"  You respond: \"{response}\"")

    # CTAs
    if ctas:
        parts.append("\nCalls to action:")
        primary = ctas.get("primary", "")
        demo = ctas.get("demo", "")
        if primary:
            parts.append(f"  Primary: {primary}")
        if demo:
            parts.append(f"  Demo: {demo}")

    # Demo booking
    if demo_booking:
        method = demo_booking.get("method", "")
        link = demo_booking.get("link", "")
        if method and link:
            parts.append(f"\nDemo booking: {method} at {link}")

    # Rules
    if rules:
        parts.append("\nRules (must follow):")
        for r in rules:
            parts.append(f"  - {r}")

    # Sales flow guidance
    parts.append("""
Sales flow (follow in order):
1. Greet: Warm opening, introduce yourself and the product briefly.
2. Discovery: Ask 1-2 open-ended questions to understand their needs.
3. Pitch: Match features to their needs. Mention relevant pricing tier.
4. Objections: Address concerns using the objection handling guide.
5. Close: Ask for the primary CTA or offer a demo.

Style constraints for VOICE:
- Speak in 2-3 short sentences max per turn.
- No markdown, no bullet lists, no URLs as text.
- Never invent features, pricing, or facts not in this prompt.
- Stay on topic; redirect off-topic questions to the product.
- English only.
""")

    return "\n".join(parts)


def build_sales_flow() -> list[dict[str, str]]:
    """Return the ordered sales flow stages with guidance.

    Each dict has: stage (str), guidance (str).
    """
    return [
        {
            "stage": "greet",
            "guidance": (
                "Open warmly. Introduce yourself and the product in one sentence. "
                "Ask how they're doing or if they have a moment."
            ),
        },
        {
            "stage": "discovery",
            "guidance": (
                "Ask 1-2 open-ended questions to uncover pain points or needs. "
                "Examples: 'What does your current outreach process look like?' "
                "or 'What's the biggest challenge your sales team faces right now?'"
            ),
        },
        {
            "stage": "pitch",
            "guidance": (
                "Connect 1-2 features to their stated needs. Mention the pricing tier "
                "that fits best. Keep it to 2-3 sentences."
            ),
        },
        {
            "stage": "objections",
            "guidance": (
                "If they raise a concern, match it to the objection handling guide. "
                "Acknowledge, then give the prepared response. Don't argue."
            ),
        },
        {
            "stage": "close",
            "guidance": (
                "Ask for the primary CTA (trial, demo, or next step). "
                "If they hesitate, offer the demo CTA as a lower-friction option."
            ),
        },
    ]


# Pre-compiled regex patterns for format_for_speech
_MARKDOWN_PATTERNS = [
    (re.compile(r"\*\*(.+?)\*\*"), r"\1"),      # **bold**
    (re.compile(r"\*(.+?)\*"), r"\1"),          # *italic*
    (re.compile(r"`(.+?)`"), r"\1"),            # `code`
    (re.compile(r"#{1,6}\s*(.+)"), r"\1"),      # # headings
    (re.compile(r"\[([^\]]+)\]\([^)]+\)"), r"\1"),  # [link](url)
    (re.compile(r"https?://\S+"), ""),          # bare URLs
]


def format_for_speech(text: str, max_sentences: int = 3) -> str:
    """Strip markdown and truncate to max_sentences for spoken output.

    Args:
        text: Raw text possibly containing markdown.
        max_sentences: Maximum number of sentences to keep (default 3).

    Returns:
        Clean text suitable for TTS: no markdown, no lists, max N sentences.
    """
    if not text:
        return ""

    # Strip markdown patterns
    cleaned = text
    for pattern, repl in _MARKDOWN_PATTERNS:
        cleaned = pattern.sub(repl, cleaned)

    # Collapse bullet/numbered list markers into sentences
    cleaned = re.sub(r"^\s*[-*+]\s+", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"^\s*\d+\.\s+", "", cleaned, flags=re.MULTILINE)

    # Normalize whitespace
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    # Split into sentences (simple heuristic: . ! ? followed by space or end)
    sentences = re.split(r"(?<=[.!?])\s+", cleaned)

    # Filter out empty
    sentences = [s.strip() for s in sentences if s.strip()]

    # Truncate
    if len(sentences) > max_sentences:
        sentences = sentences[:max_sentences]

    return " ".join(sentences)