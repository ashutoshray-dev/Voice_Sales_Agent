"""Test fixtures for post-call analysis (F08).

Contains transcript fixtures covering all six status outcomes.
"""

from __future__ import annotations

from typing import Any


# Fixture 1: Converted - customer explicitly agrees to buy
FIXTURE_CONVERTED: list[dict[str, Any]] = [
    {"role": "assistant", "content": "Hello! Thanks for taking my call. I'm calling about our premium CRM solution."},
    {"role": "user", "content": "Hi, I'm interested. Tell me more about the pricing."},
    {"role": "assistant", "content": "Our Pro plan is $99/month per user with unlimited contacts and deals."},
    {"role": "user", "content": "That sounds good. I'll sign up for the Pro plan for 5 users."},
    {"role": "assistant", "content": "Excellent! I'll send you the agreement right away."},
    {"role": "user", "content": "Perfect, please do. My email is john@company.com."},
]


# Fixture 2: Demo Requested - customer asks for or agrees to a demo
FIXTURE_DEMO: list[dict[str, Any]] = [
    {"role": "assistant", "content": "Hi there! I'm calling about our AI-powered analytics platform."},
    {"role": "user", "content": "I've heard about it. Can I see a demo first?"},
    {"role": "assistant", "content": "Absolutely! We can schedule a 30-minute demo this week."},
    {"role": "user", "content": "Yes, let's do Tuesday at 2 PM."},
    {"role": "assistant", "content": "Great, I'll send a calendar invite."},
]


# Fixture 3: Not Interested - customer clearly declines
FIXTURE_NOT_INTERESTED: list[dict[str, Any]] = [
    {"role": "assistant", "content": "Hello! I'm calling about our marketing automation tool."},
    {"role": "user", "content": "We're not looking for anything right now."},
    {"role": "assistant", "content": "I understand. Many customers felt that way before seeing the ROI."},
    {"role": "user", "content": "No thanks, we're happy with our current solution. Not interested."},
    {"role": "assistant", "content": "No problem. Thanks for your time."},
]


# Fixture 4: Follow-up Required - customer wants contact later, needs decision-maker, pricing, or more info
FIXTURE_FOLLOWUP: list[dict[str, Any]] = [
    {"role": "assistant", "content": "Hi! I'm calling about our enterprise security platform."},
    {"role": "user", "content": "This sounds interesting but I need to run it by my manager."},
    {"role": "assistant", "content": "Of course. Would it help if I sent over a pricing sheet and feature comparison?"},
    {"role": "user", "content": "Yes, please send that to me. My boss makes the final decision."},
    {"role": "assistant", "content": "Will do. When should I follow up?"},
    {"role": "user", "content": "Give me a week to review with the team, then call back."},
]


# Fixture 5: Interested - positive signals without commitment
FIXTURE_INTERESTED: list[dict[str, Any]] = [
    {"role": "assistant", "content": "Hi! I'm calling about our project management software."},
    {"role": "user", "content": "Oh, that's interesting. What features does it have?"},
    {"role": "assistant", "content": "It has Gantt charts, resource allocation, time tracking, and team collaboration."},
    {"role": "user", "content": "That's exactly what we need. The Gantt charts sound great."},
    {"role": "assistant", "content": "I'm glad to hear that! Many teams love the visual timeline."},
    {"role": "user", "content": "Yeah, this could really help us. Keep me posted on updates."},
]


# Fixture 6: No Response - customer said nothing meaningful (fewer than 2 substantive turns)
FIXTURE_NO_RESPONSE: list[dict[str, Any]] = [
    {"role": "assistant", "content": "Hello? Can you hear me?"},
    {"role": "user", "content": ""},
    {"role": "assistant", "content": "I'll call back another time."},
]


# Fixture 6b: No Response - empty transcript
FIXTURE_NO_RESPONSE_EMPTY: list[dict[str, Any]] = []


# Fixture 6c: No Response - only 1 substantive turn
FIXTURE_NO_RESPONSE_ONE_TURN: list[dict[str, Any]] = [
    {"role": "assistant", "content": "Hello! Thanks for taking my call."},
    {"role": "user", "content": "Hello."},
]


# All fixtures for easy iteration
ALL_FIXTURES = {
    "converted": FIXTURE_CONVERTED,
    "demo": FIXTURE_DEMO,
    "not_interested": FIXTURE_NOT_INTERESTED,
    "followup": FIXTURE_FOLLOWUP,
    "interested": FIXTURE_INTERESTED,
    "no_response": FIXTURE_NO_RESPONSE,
    "no_response_empty": FIXTURE_NO_RESPONSE_EMPTY,
    "no_response_one_turn": FIXTURE_NO_RESPONSE_ONE_TURN,
}


# Expected statuses for each fixture
EXPECTED_STATUSES = {
    "converted": "Converted",
    "demo": "Demo Requested",
    "not_interested": "Not Interested",
    "followup": "Follow-up Required",
    "interested": "Interested",
    "no_response": "No Response",
    "no_response_empty": "No Response",
    "no_response_one_turn": "No Response",
}