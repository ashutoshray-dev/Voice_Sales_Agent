# Smoke Test Checklist — AI Voice Sales Bot

**Run this checklist end-to-end after each deploy or major change.**  
Each line maps to one of the 8 requirements. Mark ✅ PASS or ❌ FAIL.

---

## Prerequisites
- [ ] App deployed and accessible via HTTPS (required for microphone)
- [ ] `.env` configured with valid keys (Supabase, Groq/Gemini/Ollama)
- [ ] Supabase schema applied, `recordings` bucket created
- [ ] Tested in Chrome or Edge (Web Speech API support)

---

## Requirement 1: Scaffold & Early Deploy (F01)
| Test | Steps | Expected | Result |
|------|-------|----------|--------|
| 1.1 Health endpoint | GET `/health` | `{"status":"ok","supabase_ok":true,"llm_ok":true,...}` | ☐ PASS / ☐ FAIL |
| 1.2 Smoke test page | Open `/` in browser | Page loads, shows microphone test button | ☐ PASS / ☐ FAIL |
| 1.3 HTTPS + mic | Click "Request microphone access" on `/` | Browser prompts for mic permission | ☐ PASS / ☐ FAIL |
| 1.4 Static assets | Open `/frontend/index.html` | Loads without console errors | ☐ PASS / ☐ FAIL |

---

## Requirement 2: Product Config & Sales Persona (F02)
| Test | Steps | Expected | Result |
|------|-------|----------|--------|
| 2.1 Product config loads | Check `app/config.py` imports `PRODUCT` | `config/product.yaml` parsed, no import errors | ☐ PASS / ☐ FAIL |
| 2.2 Persona in prompt | Start call, say "What do you sell?" | Bot references product.yaml (VoiceBot SaaS, pricing, features) | ☐ PASS / ☐ FAIL |
| 2.3 Objection responses | Say "Too expensive" | Bot uses scripted rebuttal from `objection_handling` | ☐ PASS / ☐ FAIL |
| 2.4 FAQ responses | Say "How realistic is the voice?" | Bot uses scripted FAQ answer | ☐ PASS / ☐ FAIL |

---

## Requirement 3: Conversation Engine (F03)
| Test | Steps | Expected | Result |
|------|-------|----------|--------|
| 3.1 WebSocket connects | Click "Start Call" → allow mic → consent | WS connects, state → `connecting` → `listening` | ☐ PASS / ☐ FAIL |
| 3.2 Streaming deltas | Speak a sentence | Bot reply appears token-by-token (streaming cursor) | ☐ PASS / ☐ FAIL |
| 3.3 Sentence boundaries | Wait for bot to finish a sentence | `sentence` message sent, TTS triggered per sentence | ☐ PASS / ☐ FAIL |
| 3.4 Multi-turn | Have 3+ exchanges | Conversation history maintained, context preserved | ☐ PASS / ☐ FAIL |
| 3.5 End call | Click "End Call" | WS sends `{type:"end"}`, state → `ended` | ☐ PASS / ☐ FAIL |
| 3.6 Provider switch | Change `LLM_PROVIDER` to `gemini`/`ollama`, restart | Works without code changes | ☐ PASS / ☐ FAIL |

---

## Requirement 4: Call UI Shell (F04)
| Test | Steps | Expected | Result |
|------|-------|----------|--------|
| 4.1 Views render | Navigate: `#/call`, `#/history`, `#/detail`, `#/postcall` | Each view shows correct content | ☐ PASS / ☐ FAIL |
| 4.2 Status pill updates | During call: connecting/listening/thinking/speaking | Pill text + color matches state | ☐ PASS / ☐ FAIL |
| 4.3 Timer runs | During active call | `MM:SS` increments every second | ☐ PASS / ☐ FAIL |
| 4.4 Typed input works | Type in message box, click Send | Message sent via WS, appears in chat | ☐ PASS / ☐ FAIL |
| 4.5 Responsive 360px | Resize browser to 360px wide | No horizontal scroll, 16px gutters, stacked controls | ☐ PASS / ☐ FAIL |
| 4.6 Responsive 1400px | Resize browser to 1400px wide | Max-width 720px centered, readable | ☐ PASS / ☐ FAIL |

---

## Requirement 5: Speech Input (F05)
| Test | Steps | Expected | Result |
|------|-------|----------|--------|
| 5.1 STT starts | After consent + mic, state = `listening` | Interim bubbles appear while speaking | ☐ PASS / ☐ FAIL |
| 5.2 Final transcript | Finish speaking | Interim replaced by final user message | ☐ PASS / ☐ FAIL |
| 5.3 Silence re-prompt | Stay silent 8s after bot speaks | Bot re-prompts gently ("Still there?") | ☐ PASS / ☐ FAIL |
| 5.4 Silence end call | Stay silent 20s total (8s + 12s) | Call ends with status `No Response` | ☐ PASS / ☐ FAIL |
| 5.5 Mic denied fallback | Deny mic permission in browser | Banner: "Microphone access denied. Type your response instead." | ☐ PASS / ☐ FAIL |
| 5.6 Unsupported browser | Test in Firefox/Safari | Compatibility banner: "Speech input not supported. Use text input." | ☐ PASS / ☐ FAIL |

---

## Requirement 6: Speech Output & Barge-In (F06)
| Test | Steps | Expected | Result |
|------|-------|----------|--------|
| 6.1 Edge-TTS plays | Bot replies | Audio plays automatically after each sentence | ☐ PASS / ☐ FAIL |
| 6.2 Mute button | Click 🔊/🔇 during playback | Audio mutes/unmutes | ☐ PASS / ☐ FAIL |
| 6.3 Volume slider | Drag volume slider | Volume changes | ☐ PASS / ☐ FAIL |
| 6.4 TTS fallback | Simulate edge-tts failure (or wait for it) | Notice: "Voice output uses browser's built-in speaker..." → speechSynthesis plays | ☐ PASS / ☐ FAIL |
| 6.5 Wait until done | Bot finishes, wait for audio | State transitions to `listening` only after audio ends | ☐ PASS / ☐ FAIL |

---

## Requirement 7: Consent & Recording (F07)
| Test | Steps | Expected | Result |
|------|-------|----------|--------|
| 7.1 Consent modal | Click "Start Call" first time | Modal opens, agree button disabled until checkbox checked | ☐ PASS / ☐ FAIL |
| 7.2 Consent granted | Check box → "Agree & Start Call" | Recording starts (mic + bot mixed) | ☐ PASS / ☐ FAIL |
| 7.3 Consent declined | Click "Decline (Start Unrecorded)" | Call starts, no recording, `recording_path=null` | ☐ PASS / ☐ FAIL |
| 7.4 Consent persisted | Refresh page → "Start Call" again | Modal skipped, previous choice remembered | ☐ PASS / ☐ FAIL |
| 7.5 Recording upload | End recorded call | Upload to Supabase Storage, `recording_path` saved | ☐ PASS / ☐ FAIL |
| 7.6 Upload failure handling | Simulate Supabase down | Call saved with `recording_path=null`, `error` set | ☐ PASS / ☐ FAIL |

---

## Requirement 8: Post-Call Analysis (F08)
| Test | Steps | Expected | Result |
|------|-------|----------|--------|
| 8.1 Analysis triggered | End call (any status) | Background job runs LLM analysis | ☐ PASS / ☐ FAIL |
| 8.2 Status classification | Check call in History/Detail | Status: `Converted`/`Interested`/`Follow-up Required`/`Not Interested`/`Demo Requested`/`No Response` | ☐ PASS / ☐ FAIL |
| 8.3 Summary present | Open Detail view | One-paragraph summary of conversation | ☐ PASS / ☐ FAIL |
| 8.4 Requirements extracted | Check Detail → Customer Requirements | List of what customer asked for/needs | ☐ PASS / ☐ FAIL |
| 8.5 Objections extracted | Check Detail → Objections Raised | List of objections customer raised | ☐ PASS / ☐ FAIL |
| 8.6 Next steps extracted | Check Detail → Next Steps | Actionable follow-up items | ☐ PASS / ☐ FAIL |
| 8.7 Post-call view | Navigate to `#/postcall?id=<call_id>` | Same analysis rendered in dedicated view | ☐ PASS / ☐ FAIL |

---

## Requirement 9: Call History (F09)
| Test | Steps | Expected | Result |
|------|-------|----------|--------|
| 9.1 History list loads | Navigate to `#/history` | List of calls for current device, newest first | ☐ PASS / ☐ FAIL |
| 9.2 Status filter | Select "Converted" from dropdown | List filters to only Converted calls | ☐ PASS / ☐ FAIL |
| 9.3 Empty state | New device (or clear localStorage) | "No calls yet. Start your first conversation!" | ☐ PASS / ☐ FAIL |
| 9.4 Detail navigation | Click a history row | Opens `#/detail?id=<call_id>` with full data | ☐ PASS / ☐ FAIL |
| 9.5 Recording playback | In Detail, click play on audio player | Signed URL fetched, audio plays (mic + bot) | ☐ PASS / ☐ FAIL |
| 9.6 Error state | Simulate API failure | "Could not load history" error state with Retry button | ☐ PASS / ☐ FAIL |

---

## F10 Hardening: Error States & UX
| Test | Steps | Expected | Result |
|------|-------|----------|--------|
| 10.1 Cold-start spinner | Fresh load (Render cold start) | "Connecting to the sales bot..." spinner until WS connects | ☐ PASS / ☐ FAIL |
| 10.2 WS drop recovery | DevTools → Network → Offline during call | Overlay: "Connection lost. Reconnecting..." + Retry button | ☐ PASS / ☐ FAIL |
| 10.3 Retry button works | Click Retry after WS drop | Reconnects, call continues | ☐ PASS / ☐ FAIL |
| 10.4 LLM 429 handling | Simulate rate limit (or wait for it) | In-call message: "I'm getting a lot of requests right now. Could you repeat that?" | ☐ PASS / ☐ FAIL |
| 10.5 TTS fallback notice | When edge-tts fails | Yellow banner appears, speechSynthesis used | ☐ PASS / ☐ FAIL |
| 10.6 Supabase down health | Stop Supabase / wrong keys | `/health` → `supabase_ok: false`, app still runs | ☐ PASS / ☐ FAIL |
| 10.7 LangSmith optional | Unset `LANGSMITH_TRACING` | App works normally | ☐ PASS / ☐ FAIL |
| 10.8 LangSmith enabled | Set `LANGSMITH_TRACING=true` + valid key | Traces appear in LangSmith dashboard | ☐ PASS / ☐ FAIL |

---

## Summary

| Requirement | Status |
|-------------|--------|
| F01: Scaffold & Deploy | ☐ PASS / ☐ FAIL |
| F02: Product Config | ☐ PASS / ☐ FAIL |
| F03: Conversation Engine | ☐ PASS / ☐ FAIL |
| F04: Call UI Shell | ☐ PASS / ☐ FAIL |
| F05: Speech Input | ☐ PASS / ☐ FAIL |
| F06: Speech Output | ☐ PASS / ☐ FAIL |
| F07: Consent & Recording | ☐ PASS / ☐ FAIL |
| F08: Post-Call Analysis | ☐ PASS / ☐ FAIL |
| F09: Call History | ☐ PASS / ☐ FAIL |
| F10: Hardening | ☐ PASS / ☐ FAIL |

**Overall:** ☐ ALL PASS / ☐ SOME FAIL

---

**Tested by:** _______________  
**Date:** _______________  
**Environment:** dev / staging / prod  
**Commit:** _______________