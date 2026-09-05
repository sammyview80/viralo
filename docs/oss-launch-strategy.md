# Viralo Open Source — Launch Strategy

Goal: turn the Apache-2.0 open-sourcing of Viralo into GitHub stars, self-hosters, contributors, and top-of-funnel awareness for the hosted product. Not a one-day event — phased rollout that compounds.

## Positioning

"Viralo: open-source AI video clipping + auto-publish engine (TikTok/IG/YouTube Shorts, 50+ platforms). Self-host it free, or use our hosted version."

The OSS release is a growth channel for the hosted SaaS, not a separate product — every self-hoster who hits scale/reliability pain is a warm hosted-plan lead. Say this explicitly in the README and launch posts ("hosted version available if you don't want to run infra").

## Pre-launch checklist (do before any public post)

- [ ] Repo is genuinely clone-and-run: `./scripts/install.sh` works cold, no manual secret hunting (done — verified live).
- [ ] README has a 10-second value prop at the top, GIF/screenshot of the product actually working (record one — nothing kills an OSS launch like a wall of text with no visual).
- [ ] `CONTRIBUTING.md` in place (done).
- [ ] Add a `CODE_OF_CONDUCT.md` if inviting outside contributors (Contributor Covenant, 5 min to add) — signals the repo is maintained, not a dump.
- [ ] GitHub repo settings: enable Issues, Discussions (for support Q&A instead of it flooding Issues), add topics/tags (`ai-video`, `tiktok`, `short-form-video`, `content-automation`, `self-hosted`) so GitHub search surfaces it.
- [ ] Pin a good first-impression Issue or two ("good first issue" label) if you want outside PRs — empty issue tracker signals dead project.
- [ ] Decide: is this single-tenant self-host only, or does licensing/support answer "can I resell this"? State it plainly in README to avoid confused issues later.

## Phased rollout (ORB framework: Owned → Rented → Borrowed)

### Phase 1 — Soft launch (owned channels, day 0)
- Post in Viralo's own channels first: Discord `#announcements`, any existing user email list, Twitter/X if there's an account with any following.
- Ask 3-5 people you trust (users, friends in the space) to try the install cold and report friction *before* going wide — the WEBSUB_SECRET-style bug class is exactly what kills first impressions if 50 people hit it at once instead of 3.

### Phase 2 — Rented channels (day 1-3)
Pick 2-3 max, don't spray everywhere:
- **Hacker News** ("Show HN: Viralo — open-source AI video clipping + auto-publish, self-hostable"). Best submitted early US morning weekday. You (the founder) must be present all day to answer every comment — this is the single highest-leverage thing for HN performance.
- **Reddit**: r/SideProject, r/selfhosted, r/opensource — tailor the pitch per sub (r/selfhosted cares about Docker Compose simplicity and data ownership; r/opensource cares about license and contribution model).
- **Twitter/X**: thread with the GIF/demo, tag people who post about TikTok/content automation, link to repo not landing page (OSS audience trusts GitHub more than a marketing page).

### Phase 3 — Borrowed channels (week 1-2)
- Reach out to 2-3 newsletter/YouTube creators in the "indie SaaS" / "self-hosted apps" / "AI tools" space — offer them nothing except "here's a thing, use it if useful." (see TRMNL example: unsponsored genuine outreach beats paid placement for OSS credibility).
- Submit to aggregator sites: awesome-selfhosted list (PR to their README), libhunt, alternativeto.net (as an open-source alternative to Opus Clip / Vadoo / similar paid tools — comparison framing drives real search traffic).

### Phase 4 — Product Hunt (week 2-3, after HN/Reddit feedback is folded in)
- Launch only after the rough edges found in phase 1-3 are fixed — PH traffic is one-shot, don't burn it on a broken install.
- Prep: tagline, 3-4 screenshots, one demo GIF, founder comment ready to post at 12:01am PT.
- You + a few friendly users active in comments all day answering questions.

### Phase 5 — Ongoing (month 1+)
- Ship visible changelog entries for real improvements — every fix signals active maintenance, which OSS users check before trusting self-hosted infra.
- Convert self-hosters who outgrow it: add a "struggling with scale? try hosted" CTA in README and in-product for those running it themselves. This is the actual monetization path.

## What to avoid

- Don't launch broadly before the install path is bulletproof — a broken first-run experience during an HN/PH spike is far worse than a quiet launch. (The `WEBSUB_SECRET` bug found during testing is exactly the class of issue to catch with the phase-1 trusted testers before phase 2/3/4.)
- Don't spray all channels simultaneously — sequential lets you fix friction found in phase 1 before phase 2's larger audience hits it.
- Don't disappear after launch day — OSS credibility is built on issues actually getting responses, not stars accumulated once and abandoned.

## Metrics to track

- GitHub stars/forks (vanity but useful for momentum signal)
- Issues opened vs closed ratio (signals responsiveness)
- Install script completion rate if you can instrument it (even a simple opt-in ping)
- Self-host → hosted-plan conversion (the actual business metric — tag any inbound "can you host this for me" leads)
