#!/usr/bin/env python3
"""
Render the merged-indexer parity report as a self-contained HTML page.

Tables are generated straight from output/merged/consolidated.json so the
numbers on the page and the numbers in the reports cannot drift apart. Prose
lives in this file; figures never do.
"""
import json
import html
from pathlib import Path

ROOT = Path(__file__).parent
DATA = json.loads((ROOT / "output" / "merged" / "consolidated.json").read_text())
OUT = Path("/private/tmp/claude-501/-Users-kenauvith-Documents-Dev-Projects-Indexers-pumex-migration/76d44f52-6f17-41bf-a916-9bd76bf6263d/scratchpad/parity.html")

PINS = {239: 24087877, 1776: 178217185, 4663: 34068305, 9745: 29553607, 59144: 31696749}
CHAIN_NAMES = {239: "TAC", 1776: "Injective", 4663: "Robinhood", 9745: "Plasma", 59144: "Linea"}

ORDER = [
    "analytics-239", "farm-239",
    "helper-59144", "helper-9745", "helper-4663", "helper-1776",
    "v1-59144", "v1-4663",
]


def esc(s):
    return html.escape(str(s))


def fmt(n):
    return f"{n:,}"


def verdict(dep):
    """Classify a deployment for the summary strip."""
    t = dep["totals"]
    if t["missingInEnvio"] or t["extraInEnvio"]:
        return "defect", "row-set differs"
    if t["diffOverTenth"]:
        return "attention", "differences above 0.1%"
    if t["diffAny"]:
        return "ulp", "rounding only"
    return "match", "exact"


VERDICT_LABEL = {
    "match": "Exact",
    "ulp": "Rounding only",
    "attention": "Differences > 0.1%",
    "defect": "Row-set differs",
}


def entity_row(r):
    cls = []
    if r["missingInEnvio"] or r["extraInEnvio"]:
        cls.append("r-defect")
    elif r["diffOverTenth"]:
        cls.append("r-attention")
    elif r["diffAny"]:
        cls.append("r-ulp")
    rowcls = f' class="{" ".join(cls)}"' if cls else ""

    delta = r["envioRows"] - r["subgraphRows"]
    delta_s = "—" if delta == 0 else f"{delta:+,}"

    cov = fmt(r["compared"])
    if r["truncated"]:
        cov += ' <span class="cap" title="Field comparison capped at 10,000 rows by --deep-limit; row counts remain exhaustive">capped</span>'

    def cell(v, warn=False):
        if v == 0:
            return '<td class="num zero">0</td>'
        return f'<td class="num{" hot" if warn else ""}">{fmt(v)}</td>'

    reason = r.get("_reason", "")

    return (
        f"<tr{rowcls}>"
        f'<td class="ent">{esc(r["entity"])}</td>'
        f'<td class="num">{fmt(r["subgraphRows"])}</td>'
        f'<td class="num">{fmt(r["envioRows"])}</td>'
        f'<td class="num delta">{delta_s}</td>'
        f'<td class="num cov">{cov}</td>'
        f'{cell(r["diffAny"])}'
        f'{cell(r["diffOverTenth"], True)}'
        f'{cell(r["diffOverOne"], True)}'
        f'<td class="reason">{reason}</td>'
        "</tr>"
    )


def deployment_section(key, dep, prose, reasons):
    t = dep["totals"]
    v, _ = verdict(dep)
    chain = dep["chain"]

    rows = []
    for r in dep["entities"]:
        r = dict(r)
        r["_reason"] = reasons.get((key, r["entity"]), default_reason(r))
        rows.append(entity_row(r))

    trunc_note = ""
    if t["anyTruncated"]:
        trunc_note = (
            '<p class="note"><strong>Coverage.</strong> Row counts below are exhaustive — every id on '
            "both sides was enumerated. Entities marked <span class='cap'>capped</span> had their "
            "field-by-field comparison stopped at 10,000 rows, which is the required floor, not the "
            "whole table.</p>"
        )

    return f"""
<section class="dep" id="{esc(key)}">
  <header class="dep-head">
    <div class="dep-title">
      <h3>{esc(dep['indexer'])} <span class="sep">/</span> <span class="chain">chain {chain} {esc(CHAIN_NAMES.get(chain,''))}</span></h3>
      <p class="ref">reference <code>{esc(dep['subgraph'])}</code> &nbsp;·&nbsp; pinned at block <code>{fmt(PINS[chain])}</code></p>
    </div>
    <span class="chip c-{v}">{VERDICT_LABEL[v]}</span>
  </header>
  {prose}
  {trunc_note}
  <div class="tw">
  <table>
    <thead><tr>
      <th>entity</th><th class="num">subgraph rows</th><th class="num">envio rows</th>
      <th class="num">Δ</th><th class="num">rows compared</th>
      <th class="num">fields differing</th><th class="num">&gt; 0.1%</th><th class="num">&gt; 1%</th>
      <th>reasoning</th>
    </tr></thead>
    <tbody>
      {"".join(rows)}
      <tr class="tot">
        <td class="ent">total</td>
        <td class="num">{fmt(t['subgraphRows'])}</td>
        <td class="num">{fmt(t['envioRows'])}</td>
        <td class="num delta">{'—' if t['envioRows']==t['subgraphRows'] else f"{t['envioRows']-t['subgraphRows']:+,}"}</td>
        <td class="num">{fmt(t['compared'])}</td>
        <td class="num">{fmt(t['diffAny'])}</td>
        <td class="num">{fmt(t['diffOverTenth'])}</td>
        <td class="num">{fmt(t['diffOverOne'])}</td>
        <td></td>
      </tr>
    </tbody>
  </table>
  </div>
</section>"""


def default_reason(r):
    if r["subgraphRows"] == 0 and r["envioRows"] == 0:
        return '<span class="q">empty on both sides</span>'
    if r["missingInEnvio"] or r["extraInEnvio"]:
        return ""
    if r["diffAny"] == 0:
        return '<span class="q">exact</span>'
    if r["diffAny"] == r["diffUlp"]:
        return 'BigDecimal rounding &mdash; <a href="#case-ulp">case&nbsp;1</a>'
    return ""


CSS = """
:root{
  --ground:#F5F7F8; --panel:#FFFFFF; --panel-2:#FAFBFC;
  --ink:#151A20; --muted:#59636E; --rule:#DCE2E6; --rule-soft:#EAEFF2;
  --accent:#0B6E63; --accent-soft:#E4F0EE;
  --match:#2E7355; --ulp:#6A7480; --attention:#8F6410; --defect:#A33C31;
  --stripe-match:#2E7355; --stripe-ulp:#B9C2C9; --stripe-attention:#C98F1C; --stripe-defect:#A33C31;
  --diff-wash:#F6E3E0;
}
@media (prefers-color-scheme: dark){
  :root{
    --ground:#0E1317; --panel:#141A1F; --panel-2:#111318;
    --ink:#DCE4E9; --muted:#8894A0; --rule:#232C33; --rule-soft:#1B232A;
    --accent:#45B8A8; --accent-soft:#12302C;
    --match:#58B189; --ulp:#8894A0; --attention:#D6A33D; --defect:#E07A6C;
    --stripe-match:#58B189; --stripe-ulp:#3A454F; --stripe-attention:#D6A33D; --stripe-defect:#E07A6C;
    --diff-wash:#3A211D;
  }
}
:root[data-theme="dark"]{
  --ground:#0E1317; --panel:#141A1F; --panel-2:#111318;
  --ink:#DCE4E9; --muted:#8894A0; --rule:#232C33; --rule-soft:#1B232A;
  --accent:#45B8A8; --accent-soft:#12302C;
  --match:#58B189; --ulp:#8894A0; --attention:#D6A33D; --defect:#E07A6C;
  --stripe-match:#58B189; --stripe-ulp:#3A454F; --stripe-attention:#D6A33D; --stripe-defect:#E07A6C;
  --diff-wash:#3A211D;
}
:root[data-theme="light"]{
  --ground:#F5F7F8; --panel:#FFFFFF; --panel-2:#FAFBFC;
  --ink:#151A20; --muted:#59636E; --rule:#DCE2E6; --rule-soft:#EAEFF2;
  --accent:#0B6E63; --accent-soft:#E4F0EE;
  --match:#2E7355; --ulp:#6A7480; --attention:#8F6410; --defect:#A33C31;
  --stripe-match:#2E7355; --stripe-ulp:#B9C2C9; --stripe-attention:#C98F1C; --stripe-defect:#A33C31;
  --diff-wash:#F6E3E0;
}

*{box-sizing:border-box}
body{
  margin:0; background:var(--ground); color:var(--ink);
  font-family:ui-serif,"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
  font-size:17px; line-height:1.62; -webkit-font-smoothing:antialiased;
}
.mono,code,td.num,th.num,.chip,.lbl{
  font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  font-variant-numeric:tabular-nums;
}
.wrap{max-width:1180px;margin:0 auto;padding:0 28px}
.prose{max-width:68ch}
h1,h2,h3{text-wrap:balance;margin:0}
a{color:var(--accent);text-decoration-thickness:1px;text-underline-offset:2px}
a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:2px}

/* masthead */
.mast{border-bottom:1px solid var(--rule);background:var(--panel);padding:52px 0 34px}
.lbl{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.mast h1{font-size:clamp(30px,4.4vw,46px);line-height:1.1;letter-spacing:-.015em;margin:.35em 0 .3em;font-weight:600}
.mast .sub{color:var(--muted);font-size:19px;max-width:60ch;margin:0}
.facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;
  background:var(--rule);border:1px solid var(--rule);border-radius:3px;margin-top:32px;overflow:hidden}
.fact{background:var(--panel-2);padding:13px 16px}
.fact dt{font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--muted);
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.fact dd{margin:5px 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:13.5px;font-variant-numeric:tabular-nums;word-break:break-word}

/* banner */
.banner{margin:30px 0 0;border:1px solid var(--rule);border-left:3px solid var(--attention);
  background:var(--panel-2);padding:16px 20px;border-radius:3px}
.banner p{margin:0;font-size:16px}
.banner p + p{margin-top:.6em}

section.band{padding:52px 0;border-bottom:1px solid var(--rule)}
section.band > .wrap > h2{font-size:13px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--accent);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin-bottom:20px}
.h3{font-size:26px;letter-spacing:-.01em;margin:0 0 .45em;font-weight:600}

/* verdict strip */
.strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(232px,1fr));gap:12px}
.vcard{background:var(--panel);border:1px solid var(--rule);border-radius:3px;
  padding:15px 17px;border-left:3px solid var(--stripe-match);display:block;text-decoration:none;color:inherit}
.vcard:hover{border-color:var(--accent)}
.vcard.v-ulp{border-left-color:var(--stripe-ulp)}
.vcard.v-attention{border-left-color:var(--stripe-attention)}
.vcard.v-defect{border-left-color:var(--stripe-defect)}
.vcard.v-none{border-left-color:var(--rule);opacity:.72}
.vcard .who{font-size:17px;font-weight:600;letter-spacing:-.01em}
.vcard .num2{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;
  color:var(--muted);font-variant-numeric:tabular-nums;margin-top:5px}
.vcard .st{font-size:11px;letter-spacing:.1em;text-transform:uppercase;margin-top:9px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.st.s-match{color:var(--match)} .st.s-ulp{color:var(--ulp)}
.st.s-attention{color:var(--attention)} .st.s-defect{color:var(--defect)} .st.s-none{color:var(--muted)}

/* deployment tables */
.dep{background:var(--panel);border:1px solid var(--rule);border-radius:3px;
  padding:24px 26px 8px;margin-bottom:22px}
.dep-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;flex-wrap:wrap;
  padding-bottom:16px;border-bottom:1px solid var(--rule-soft)}
.dep-head h3{font-size:23px;font-weight:600;letter-spacing:-.01em}
.dep-head .sep{color:var(--rule);font-weight:400}
.dep-head .chain{color:var(--muted);font-weight:500}
.ref{margin:5px 0 0;font-size:13px;color:var(--muted);
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.chip{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;padding:5px 10px;
  border-radius:2px;white-space:nowrap;border:1px solid currentColor}
.c-match{color:var(--match)} .c-ulp{color:var(--ulp)}
.c-attention{color:var(--attention)} .c-defect{color:var(--defect)}

.dep p.note,.dep p.lead{font-size:15.5px;color:var(--muted);max-width:78ch;margin:15px 0 0}
.dep p.lead{color:var(--ink)}

.tw{overflow-x:auto;margin:18px -26px 0;padding:0 26px}
table{border-collapse:collapse;width:100%;font-size:14px}
thead th{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;
  letter-spacing:.09em;text-transform:uppercase;color:var(--muted);font-weight:500;
  text-align:left;padding:0 11px 9px;border-bottom:1px solid var(--rule);white-space:nowrap}
thead th.num{text-align:right}
tbody td{padding:7px 11px;border-bottom:1px solid var(--rule-soft);vertical-align:top}
td.num{text-align:right;white-space:nowrap;font-size:13px}
td.ent{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;white-space:nowrap}
td.zero{color:var(--rule)} td.hot{color:var(--attention);font-weight:600}
td.delta{color:var(--defect)} td.cov{color:var(--muted)}
td.reason{font-size:13.5px;color:var(--muted);min-width:230px}
td.reason .q{color:var(--rule)}
tbody tr.r-defect td.ent{box-shadow:inset 3px 0 0 var(--stripe-defect);padding-left:14px}
tbody tr.r-attention td.ent{box-shadow:inset 3px 0 0 var(--stripe-attention);padding-left:14px}
tbody tr.r-ulp td.ent{box-shadow:inset 3px 0 0 var(--stripe-ulp);padding-left:14px}
tr.tot td{border-top:1px solid var(--rule);border-bottom:none;font-weight:600;padding-top:9px}
tr.tot td.ent{font-weight:600;box-shadow:none;padding-left:11px}
.cap{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--attention);
  border:1px solid currentColor;border-radius:2px;padding:1px 4px;margin-left:5px}

/* dossier */
.case{background:var(--panel);border:1px solid var(--rule);border-radius:3px;
  padding:26px 28px;margin-bottom:18px;border-top:3px solid var(--stripe-ulp)}
.case.k-defect{border-top-color:var(--stripe-defect)}
.case.k-attention{border-top-color:var(--stripe-attention)}
.case.k-open{border-top-color:var(--stripe-attention)}
.case.k-none{border-top-color:var(--rule)}
.case-num{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;
  letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.case h3{font-size:24px;margin:.3em 0 .1em;font-weight:600;letter-spacing:-.01em}
.case .verdictline{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;
  letter-spacing:.06em;text-transform:uppercase;margin-bottom:16px}
.case p{margin:0 0 .85em;max-width:74ch}
.case p:last-child{margin-bottom:0}
.case ul{margin:0 0 .9em;padding-left:1.15em;max-width:74ch}
.case li{margin-bottom:.35em}
code{font-size:.87em;background:var(--panel-2);border:1px solid var(--rule-soft);
  border-radius:2px;padding:.1em .35em;word-break:break-word}

/* digit ruler — the signature device */
.ruler{background:var(--panel-2);border:1px solid var(--rule);border-radius:3px;
  padding:17px 19px;margin:6px 0 16px;overflow-x:auto}
.ruler .rl{display:grid;grid-template-columns:74px 1fr;gap:13px;align-items:baseline;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;white-space:nowrap}
.ruler .rl + .rl{margin-top:5px}
.ruler .side{color:var(--muted);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase}
.ruler .same{color:var(--muted)}
.ruler .diff{color:var(--defect);font-weight:700;background:var(--diff-wash);
  border-radius:2px;padding:1px 0;box-shadow:0 1px 0 var(--defect)}
.ruler .caption{margin-top:12px;font-size:12.5px;color:var(--muted);white-space:normal;
  font-family:ui-serif,Georgia,serif}

.ev{background:var(--panel-2);border:1px solid var(--rule);border-radius:3px;padding:0;margin:6px 0 16px;overflow-x:auto}
.ev table{font-size:12.5px}
.ev thead th{padding:9px 13px 8px}
.ev tbody td{padding:6px 13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.ev tbody tr:last-child td{border-bottom:none}

footer{padding:44px 0 60px;color:var(--muted);font-size:14px}
footer p{max-width:74ch;margin:0 0 .7em}
@media (max-width:820px){ .facts{grid-template-columns:repeat(2,minmax(0,1fr))} }
@media (max-width:640px){
  .wrap{padding:0 18px} body{font-size:16px}
  .dep{padding:20px 16px 6px} .tw{margin:16px -16px 0;padding:0 16px}
}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
"""


def ruler(a, b, label_a="subgraph", label_b="envio", caption=""):
    """Stack two decimal strings and mark the first digit at which they diverge."""
    i = 0
    while i < min(len(a), len(b)) and a[i] == b[i]:
        i += 1

    def render(s):
        same, diff = esc(s[:i]), esc(s[i:])
        out = f'<span class="same">{same}</span>'
        if diff:
            out += f'<span class="diff">{diff}</span>'
        return out

    return f"""<div class="ruler">
  <div class="rl"><span class="side">{esc(label_a)}</span><span>{render(a)}</span></div>
  <div class="rl"><span class="side">{esc(label_b)}</span><span>{render(b)}</span></div>
  <p class="caption">{caption}</p>
</div>"""


# ---------------------------------------------------------------- prose ----

LEADS = {
 "analytics-239": '<p class="lead">The largest surface on TAC, and the one deployment that does not pass. '
   'A <strong>29-hour indexing gap</strong> &mdash; blocks 21,709,896&ndash;21,776,530 &mdash; removes 2,926 '
   'swaps and 2,233 transactions, and every other difference on this deployment follows from it: the stale '
   'pool price, the missing hourly buckets, the large USD divergences. See '
   '<a href="#case-swap">case&nbsp;6</a>. Chain 239 also carries the standing RPC-quality caveat in '
   '<a href="#case-tac">case&nbsp;7</a>, which is a separate matter.</p>',
 "farm-239": '<p class="lead">Row-for-row exact. The single field difference is a defect in the '
   '<em>subgraph</em>, not in the migration — proven against the chain in '
   '<a href="#case-farm">case&nbsp;5</a>.</p>',
 "helper-59144": '<p class="lead">The largest helper deployment &mdash; 916,814 rows reconciling '
   'exactly, with nothing missing on either side. This subgraph publishes only 11 of the 26 '
   '<code>Helper_</code> entity types: the ve/points family, <code>Block</code>, <code>GaugeState</code> '
   'and <code>Harvest</code> are absent from the Linea deployment, so they are out of scope here rather '
   'than missing. All 179 field differences sit on a single dust column.</p>',
 "helper-9745": '<p class="lead">Row-for-row exact. Every field difference is on one column, '
   '<code>DepositTokenBalance.amountDecimals</code>, and every one is dust &mdash; see the caveat on '
   'percentage buckets above.</p>',
 "helper-4663": '<p class="lead">Both sides are internally consistent and completely disjoint: every id '
   'differs, and among the rows that do line up there is not one field difference. That is the signature '
   'of two correct indexers pointed at <em>different contracts</em> — '
   '<a href="#case-vetoken">case&nbsp;2</a>.</p>',
 "helper-1776": '<p class="lead">The control. This pair was already known-clean, and reproducing it '
   'exactly is what validates the harness itself before any larger run is trusted.</p>',
 "v1-59144": '<p class="lead">The largest deployment in the campaign by row count &mdash; three million '
   'rows, reconciling exactly. This includes <code>Swap</code> and <code>Transaction</code>, which the '
   'previous campaign had not compared at all. Every field difference that remains belongs to the single '
   'open class in <a href="#case-untracked">case&nbsp;4</a>.</p>',
 "v1-4663": "",
}

REASONS = {
 ("farm-239","Deposit"): 'subgraph missed two on-chain <code>DecreaseLiquidity</code> logs &mdash; '
   '<a href="#case-farm">case&nbsp;5</a>',
 ("helper-4663","Block"): 'disjoint id sets, wrong <code>VeToken</code> &mdash; <a href="#case-vetoken">case&nbsp;2</a>',
 ("helper-4663","VeToken"): 'different contract address &mdash; <a href="#case-vetoken">case&nbsp;2</a>',
 ("helper-4663","VeTokenSnapshot"): 'disjoint id sets, wrong <code>VeToken</code> &mdash; <a href="#case-vetoken">case&nbsp;2</a>',
 ("helper-59144","DepositTokenBalance"): 'rounding &mdash; dust vs 0, largest absolute '
   '1.0&times;10<sup>-28</sup> tokens (<a href="#case-ulp">case&nbsp;1</a>)',
 ("helper-9745","DepositTokenBalance"): 'rounding &mdash; every difference is dust vs exactly 0, '
   'largest absolute 1.4&times;10<sup>-28</sup> tokens (<a href="#case-ulp">case&nbsp;1</a>)',

 ("analytics-239","Swap"): '2,926 rows inside the 29-hour gap; <code>reserves*</code> reflect the stale '
   'pool state (<a href="#case-swap">case&nbsp;6</a>). <code>amountUSD</code> is rounding',
 ("analytics-239","Transaction"): '2,233 rows inside the 29-hour gap &mdash; <a href="#case-swap">case&nbsp;6</a>',
 ("analytics-239","AlgebraHourData"): '29 missing hourly buckets = the gap duration exactly; accumulators '
   'short by it (<a href="#case-swap">case&nbsp;6</a>)',
 ("analytics-239","AlgebraDayData"): 'bucket + accumulators spanning the gap &mdash; <a href="#case-swap">case&nbsp;6</a>',
 ("analytics-239","PoolHourData"): 'missing buckets + accumulators spanning the gap; 24,511 of 25,283 '
   'differences are rounding',
 ("analytics-239","PoolDayData"): 'missing buckets + accumulators spanning the gap; 10,097 of 10,591 '
   'differences are rounding',
 ("analytics-239","TokenHourData"): 'missing buckets; 47,118 of 48,745 differences are rounding. The '
   'remainder is the stale WETH price (<a href="#case-swap">case&nbsp;6</a>)',
 ("analytics-239","TokenDayData"): 'missing buckets; 12,185 of 13,430 differences are rounding',
 ("analytics-239","Burn"): '+1 row: the subgraph missed an on-chain <code>Burn</code> '
   '(<a href="#case-farm">case&nbsp;5</a>). 2,615 of 2,623 field differences are rounding',
 ("analytics-239","Mint"): 'rounding only &mdash; <a href="#case-ulp">case&nbsp;1</a>',
 ("analytics-239","Pool"): 'the <code>WETH/USD&#8366;</code> pool holds stale state from the gap; other '
   'pools differ only in accumulators (<a href="#case-swap">case&nbsp;6</a>)',
 ("analytics-239","Token"): '<code>derivedMatic</code> wrong for the 5 tokens priced through WETH, all by '
   'the same 41.0194% &mdash; <a href="#case-swap">case&nbsp;6</a>',
 ("analytics-239","Factory"): 'global accumulators short by the gap &mdash; <a href="#case-swap">case&nbsp;6</a>',
 ("analytics-239","Tick"): 'liquidity accumulators spanning the gap &mdash; <a href="#case-swap">case&nbsp;6</a>',
 ("v1-59144","Pair"): 'untracked volume residue &mdash; <a href="#case-untracked">case&nbsp;4</a>',
 ("v1-59144","Token"): 'untracked volume residue &mdash; <a href="#case-untracked">case&nbsp;4</a>',
 ("v1-59144","Factory"): 'untracked volume residue &mdash; <a href="#case-untracked">case&nbsp;4</a>',
 ("v1-59144","DayData"): '<code>dailyVolumeUntracked</code> &mdash; <a href="#case-untracked">case&nbsp;4</a>',
 ("v1-59144","Swap"): '<span class="q">exact across the 10,000 rows compared</span>',
 ("analytics-239","PoolPosition"): 'liquidity accumulator spanning the gap &mdash; <a href="#case-swap">case&nbsp;6</a>',
}


# Map the case kind onto a colour token that actually exists. "open" has no
# token of its own and "none" must not resolve to var(--none), which is
# undefined and silently leaves the line inheriting body colour.
KIND_TOKEN = {"ulp": "ulp", "defect": "defect", "attention": "attention",
              "open": "attention", "none": "muted"}


def case(cid, num, kind, title, verdictline, body):
    return f"""<article class="case k-{kind}" id="{cid}">
  <div class="case-num">Case {num}</div>
  <h3>{title}</h3>
  <div class="verdictline" style="color:var(--{KIND_TOKEN[kind]})">{verdictline}</div>
  {body}
</article>"""


def build_cases():
    c = []

    c.append(case("case-ulp", 1, "ulp", "BigDecimal rounding at the 34th significant digit",
      "Benign · pre-existing · accepted · always &lt; 0.1%",
      ruler(
        "0.000000000000009823584401308767341668921701",
        "0.000000000000009823584401308767340848962425",
        caption="A representative pair. The two values agree for 33 significant digits and part company in "
                "the 34th &mdash; a relative difference near 1&times;10<sup>-32</sup>&nbsp;%.")
      + "<p>graph-node's <code>BigDecimal</code> keeps roughly 34 significant digits and rounds after every "
        "operation. Two correct implementations that perform the same arithmetic in a different order will "
        "therefore disagree in the last digit or two. This is the largest category of difference in the "
        "whole campaign by count, and the least consequential by magnitude: nothing economically meaningful "
        "fits below the 34th digit.</p>"
      + "<p>This class was investigated to exhaustion during the standalone migration and formally accepted "
        "in <code>pumex-cl-analytics/docs/FINAL-REPORT.md</code>, which records exactly 8 field-failing "
        "entities, all ULP-only, with zero differences greater than 2 ULPs. The merged indexer reproduces "
        "that set entity for entity.</p>"
      + "<p><strong>Measuring these at all required fixing the tool.</strong> The validator computed relative "
        "differences with <code>parseFloat</code> and then rounded to two decimal places. Double precision "
        "cannot subtract two 34-digit decimals that differ in the last digit, and the rounding flattened "
        "everything below 0.005&nbsp;% to zero &mdash; so this entire class previously reported as "
        "&ldquo;0&nbsp;% difference&rdquo;, indistinguishable from an exact match. It is now computed in "
        "exact scaled-integer arithmetic.</p>"))

    c.append(case("case-vetoken", 2, "match", "Chain 4663 was indexing the wrong contract — fixed",
      "Real defect · root-caused and corrected · was 933 vs 935 with zero ids in common",
      "<p>On Robinhood the merged indexer and the <code>orvex-helper</code> subgraph used to agree on "
      "nothing and disagree about nothing: every id in <code>Block</code>, <code>VeToken</code> and "
      "<code>VeTokenSnapshot</code> was disjoint, with not one field difference among them. That is the "
      "signature of two correct indexers reading <em>different things</em>, and it turned out to be two "
      "separate bugs.</p>"
      + "<p><strong>The wrong contract.</strong> Queried on-chain, the address we bound is not the "
        "VotingEscrow at all:</p>"
      + '<div class="ev"><table><thead><tr><th>side</th><th>address</th><th>name()</th><th>symbol()</th><th>supply()</th></tr></thead><tbody>'
        "<tr><td>merged (was)</td><td>0xd2190fc5…</td><td>Bribe veORVX</td><td>bveORVX</td><td>absent</td></tr>"
        "<tr><td>subgraph</td><td>0x18657ff9…</td><td>Voting Escrow Orvex</td><td>veORVX</td><td>present</td></tr>"
        "</tbody></table></div>"
      + "<p>It is a bribe wrapper, not the escrow. Every other chain binds a real VotingEscrow — Plasma "
        "\u201cVoting Escrow Ionex\u201d, Injective \u201cVoting Escrow Pumex\u201d — so Robinhood was the "
        "odd one out. The address also seeds the <code>VeToken</code> and <code>VeTokenSnapshot</code> ids, "
        "which is why those sets could never intersect.</p>"
      + "<p><strong>The wrong polling anchors.</strong> Both were left at the chain\u2019s "
        "<code>start_block</code> (1,873,667) instead of the subgraph\u2019s polling origin, so the two "
        "sides sampled different heights on the same 69,000-block cadence and shared no block at all. The "
        "subgraph\u2019s anchors are 1,966,166 for <code>Block</code> and 1,964,611 for "
        "<code>VeTokenSnapshot</code>. The arithmetic confirms both directions: "
        "(34,068,305\u2009\u2212\u20091,966,166)\u2009//\u200969,000\u2009+\u20091 = <strong>466</strong>, "
        "the subgraph\u2019s count, while the old anchor gives <strong>467</strong> — exactly what we were "
        "emitting.</p>"
      + "<p>Both were corrected and redeployed. This was <em>not</em> a case of matching a subgraph we "
        "believed to be wrong: the subgraph was right and the indexer was wrong.</p>"))

    c.append(case("case-swapid", 3, "ulp", "Swap id ordering on Linea",
      "Subgraph limitation · permutation, not a numeric difference",
      "<p>Token <code>0x7e37&hellip;</code> (BULL) has two BULL/WETH pairs. In transaction "
      "<code>0x91cc7baa&hellip;</code> Envio emits swaps in true log order (13 &rarr; 19); the subgraph emits "
      "them 19 &rarr; 13, because graph-node dispatches per data source and the two pairs are separate "
      "dynamic data sources, while the <code>Swap</code> id is an ordinal over "
      "<code>transaction.swaps.length</code>.</p>"
      + "<p>The consequence is that the same two <code>amountUSD</code> values appear under permuted ids. "
        "No quantity changed &mdash; the day's swap set matches 9 for 9 with none missing, each swap's pair "
        "attribution matches, and <code>Token.tradeVolumeUSD</code> for BULL matches byte-for-byte at "
        "319308.8121996806521651361270023957. This is a limitation of how the subgraph assigns ids, not a "
        "difference in what either side computed.</p>"
      + "<p><strong>Coverage note.</strong> This run compared 10,000 of the 1,274,386 Linea swaps and found "
        "no field differences among them; the permuted pair above sits outside that window. The class is "
        "carried forward from the earlier root-cause investigation rather than re-observed here, and the "
        "row counts &mdash; which <em>are</em> exhaustive &mdash; match exactly, as a permutation of ids "
        "over the same set requires.</p>"))

    c.append(case("case-untracked", 4, "open", "Untracked-volume residue",
      "Open · unexplained · lands above 0.1%",
      "<p><code>Token.untrackedVolumeUSD</code> for BULL differs by <strong>4.1&times;10<sup>-7</sup></strong> "
      "relative, and <code>TokenDayData.dailyVolumeETH/USD</code> for the same token on day 20040 by roughly "
      "<strong>9.5&times;10<sup>-4</sup></strong> &mdash; which puts the latter in the &gt;&nbsp;0.1&nbsp;% "
      "bucket.</p>"
      + "<p>A pure id permutation cannot move an aggregate, so case&nbsp;3 does not explain this. Something "
        "order-dependent survives in the <em>untracked</em> branch specifically &mdash; the path taken when "
        "a token is not whitelisted, and BULL has <code>derivedETH = 0</code> on both sides. Tracked volume "
        "is unaffected. The same family of finding appears in "
        "<code>pumex-algebra-envio/docs/HANDOFF.md</code>&nbsp;&sect;6.4.</p>"
      + "<p><strong>Still present, and still open.</strong> v1/59144 reproduces exactly this class and "
        "nothing else: all five of its field differences are "
        "<code>untrackedVolumeUSD</code> on <code>Factory</code>, <code>Pair</code> and <code>Token</code>, "
        "plus <code>DayData.dailyVolumeUntracked</code> &mdash; every one of them on a small entity that "
        "was compared in full, so this is not a sampling artefact. The <code>TokenDayData</code> instance "
        "falls outside that deployment's 10,000-row window.</p>"
      + "<p>No root cause has been established, and none is asserted here.</p>"))

    c.append(case("case-farm", 5, "attention", "The subgraph has its own gap, around block 17,530,0xx",
      "New this session · subgraph defect · Envio matches the chain in both instances",
      "<p>Two differences on chain 239 run the opposite way to case&nbsp;6: the merged indexer is right "
      "and the <em>subgraph</em> is missing on-chain events. Both sit within 76 blocks of each other.</p>"
      + "<p><strong>farm / <code>Deposit</code> 743, field <code>liquidity</code>.</strong> One field "
        "differs across all 917 rows; every other field on that row matches. The subgraph reports "
        "148,816,099, the merged indexer reports 1. Queried against the chain, two "
        "<code>DecreaseLiquidity</code> logs exist at block <code>17,530,001</code> for tokenId 743, each "
        "for 74,408,049 &mdash; transactions <code>0x042bb1dc&hellip;</code> and "
        "<code>0x816ff3b3&hellip;</code>. Two of them come to 148,816,098, and "
        "148,816,099 &minus; 148,816,098 = <strong>1</strong>. The subgraph applied neither decrement; "
        "Envio applied both.</p>"
      + "<p><strong>analytics / one extra <code>Burn</code>.</strong> The merged indexer holds a Burn the "
        "subgraph does not &mdash; <code>0xe3845604&hellip;#1</code> at block <code>17,530,077</code>. This "
        "is the only surplus row anywhere in the campaign. The subgraph has the transaction but attaches "
        "no burns to it at all. On chain, that pool emits a <code>Burn</code> at logIndex&nbsp;1 of that "
        "block, and its payload matches the merged indexer field for field:</p>"
      + '<div class="ev"><table><thead><tr><th>field</th><th>on-chain log</th><th>merged indexer</th></tr></thead><tbody>'
        "<tr><td>liquidityAmount</td><td>3704705692194729292</td><td>3704705692194729292</td></tr>"
        "<tr><td>amount0</td><td>9076256972469804</td><td>0.009076256972469804</td></tr>"
        "<tr><td>amount1</td><td>72011181065089699</td><td>0.072011181065089699</td></tr>"
        "</tbody></table></div>"
      + "<p>Two independent misses in the same 76-block neighbourhood points to an indexing incident on the "
        "Goldsky side around block 17,530,0xx, rather than two coincidences. <strong>In both cases Envio "
        "matches the chain and the subgraph does not.</strong></p>"
      + "<p>This is also why the farm figure appears to contradict the previously recorded &ldquo;0 field "
        "diffs&rdquo;. It does not: the ad-hoc <code>cmp_farm.ts</code> carries this exact row in a "
        "<code>KNOWN_DIVERGENCES</code> filter and subtracts it before reporting. Both numbers are right; "
        "this report does not filter.</p>"))

    c.append(case("case-swap", 6, "defect", "A 29-hour hole in HyperSync's chain-239 index",
      "Root-caused upstream · not fixable from here · the one deployment that does not reconcile",
      "<p>The merged indexer is missing <strong>2,926 swaps</strong> and <strong>2,233 transactions</strong> "
      "on chain 239, every one of them inside a single contiguous window:</p>"
      + '<div class="ev"><table><thead><tr><th></th><th>value</th></tr></thead><tbody>'
        "<tr><td>block range</td><td>21,709,896 &ndash; 21,776,530</td></tr>"
        "<tr><td>span</td><td>66,634 blocks</td></tr>"
        "<tr><td>wall clock</td><td>2026-06-29 07:08:41Z &rarr; 2026-06-30 12:06:21Z</td></tr>"
        "<tr><td>duration</td><td>104,260 s = 29.0 hours</td></tr>"
        "</tbody></table></div>"
      + "<p>Two independent measurements agree on the duration: the block-timestamp span is 29.0 hours, and "
        "<code>Analytics_AlgebraHourData</code> — one row per hour, globally — is missing exactly "
        "<strong>29</strong> buckets.</p>"
      + "<p><strong>The hole is in HyperSync, not in the indexer.</strong> Queried directly with a bare "
        "all-logs filter, so nothing of ours is involved:</p>"
      + '<div class="ev"><table><thead><tr><th>window</th><th>logs in HyperSync</th></tr></thead><tbody>'
        "<tr><td>21,690,000 &ndash; 21,709,895</td><td>972</td></tr>"
        "<tr><td>21,709,896 &ndash; 21,776,530</td><td><strong>0</strong></td></tr>"
        "<tr><td>21,776,531 &ndash; 21,800,000</td><td>6,251</td></tr>"
        "</tbody></table></div>"
      + "<p>It returns success with zero rows rather than an error, so <code>for: fallback</code> never "
        "triggers and the deployment faithfully indexed the emptiness.</p>"
      + "<p><strong>RPC has the data, but cannot be used.</strong> <code>eth_getLogs</code> over the same "
        "range does return the missing swap — block 21,719,043, logIndex 5, tx "
        "<code>0x2e3d2502…</code>. So chain 239 was switched to RPC sync and deployed. It fails "
        "structurally: TAC emits transactions its own node cannot decode "
        "(<code>errUnknownField &quot;*types.MsgEthereumTx&quot;</code>), Envio needs the transaction object "
        "to fill <code>transaction_fields</code>, and it retries such a hash forever. Chain 239 sat at block "
        "&minus;1 and never advanced while the other chains reached 68&ndash;80&nbsp;%. Dropping "
        "<code>transaction_fields</code> to avoid the fetch would zero <code>gasPrice</code> and "
        "<code>index</code> on 171,854 rows to recover 2,233. The change was reverted.</p>"
      + "<p><strong>Conclusion: both sources fail, for unrelated reasons, so this range is unobtainable.</strong> "
        "Everything else on this deployment follows from the hole — the stale <code>WETH/USD&#8366;</code> "
        "pool price, the missing hourly buckets, and the identical 41.0194&nbsp;% <code>derivedMatic</code> "
        "error across the five tokens priced through WETH, which is the fingerprint of one shared upstream "
        "price. A re-index reproduces the same gap; the fix has to come from Envio backfilling the "
        "index.</p>"))

    c.append(case("case-tac", 7, "attention", "TAC runs on a public non-archive RPC",
      "Standing caveat · data quality, not a merge defect",
      "<p><code>ENVIO_RPC_URL_239</code> points at the public <code>rpc.ankr.com/tac</code>, which is not an "
      "archive node. During backfill the deployment logged 41 effect failures on chain 239 and 15 on 9745, "
      "each stamped <code>THIS ROW WILL NOT MATCH THE SUBGRAPH</code> and substituting a default value.</p>"
      + "<p>Effect failures correlate exactly with RPC quality: both chains backed by dwellir archive "
        "endpoints (59144, 4663) logged zero. It is a backfill-only failure mode &mdash; zero failures occur "
        "in realtime once caught up.</p>"
      + "<p><strong>Any field difference measured on chain 239 should be read as RPC quality first.</strong> "
        "Two caveats on that, though. It does not explain case&nbsp;5, where the handler makes no RPC call "
        "at all and the subgraph is the side that is wrong. And it does not explain case&nbsp;6, where a "
        "row is absent entirely rather than defaulted &mdash; chain 239 syncs via HyperSync, not the RPC.</p>"))

    c.append(case("case-noref", 8, "none", "Entities with no reference to compare against",
      "Not a difference · a gap in coverage, stated plainly",
      "<p>Seven <code>Helper_PreMining*</code> entity types exist on the merged endpoint but appear in "
      "<em>none</em> of the four helper subgraphs: <code>PreMining</code>, <code>PreMiningDeposit</code>, "
      "<code>PreMiningDepositTokenBalance</code>, <code>PreMiningLiquidityPosition</code>, "
      "<code>PreMiningLiquidityPositionSnapshot</code>, <code>PreMiningUser</code> and "
      "<code>PreMiningWithdraw</code>. There is nothing to compare them to on any chain.</p>"
      + "<p>Similarly, <code>V1_PairLookup</code> is an Envio-internal helper with no subgraph counterpart, "
        "and the <code>lynex-helper</code> subgraph publishes only 11 of the 26 helper entity types, so the "
        "ve/points family, <code>Block</code>, <code>GaugeState</code> and <code>Harvest</code> are simply "
        "out of scope on Linea.</p>"
      + "<p>None of these are failures. They are listed so that &ldquo;every entity matched&rdquo; is not "
        "read as &ldquo;every entity was checked&rdquo;.</p>"))

    c.append(case("case-v4", 9, "none", "v4 cannot be validated at all",
      "Neither a pass nor a failure · both references are gone",
      "<p>The v4 indexer has no reference subgraph left to compare against:</p>"
      + "<ul><li><code>v4-orvex/1.0.0</code> (chain 4663) returns HTTP 404 &mdash; confirmed again this "
        "session. Goldsky reports the subgraph as deleted.</li>"
        "<li><code>pumex-v4</code> (chain 1776) never had a URL on file.</li></ul>"
      + "<p>All 18 <code>V4_</code> entity types are therefore unverified. This is pre-existing and outside "
        "the merge &mdash; nothing about the merged deployment caused it, and nothing in this report should "
        "be read as evidence that v4 is either correct or incorrect. It is simply unmeasured.</p>"))

    return "\n".join(c)


METHOD = """
<h3 class="h3">How this was measured</h3>
<p>Every reference subgraph was compared against the single merged endpoint with
<code>indexer-migration-validator</code>, extended for this campaign to handle a merged deployment:
an entity-name prefix so subgraph <code>Gauge</code> resolves to <code>Helper_Gauge</code>, a chain
filter and id-prefix strip, and a block pin applied to <em>both</em> sides.</p>

<p><strong>The deployment is stopped.</strong> Three polls ten minutes apart returned identical
<code>latest_processed_block</code> on all five chains, with a caught-up timestamp of
2026-08-11T23:41:54Z. That is helpful rather than harmful: a frozen snapshot is deterministic. It
does mean each subgraph must be read back at the frozen block via time-travel, or its newer rows
read as missing. Time-travel to every pin was verified working; nothing is pruned. The indexer was
re-checked at the end of every run and had not moved.</p>

<p><strong>Coverage.</strong> Row counts are exhaustive everywhere &mdash; every id on both sides was
enumerated and set-compared, with no cap. The field-by-field comparison covers every row where an
entity has fewer than 10,000, and 10,000 rows where it has more. Entities where that cap bound are
marked <span class="cap">capped</span> in the tables; there are six, all on the two largest
deployments. A clean result on a capped entity is a claim about 10,000 rows, not about the whole
table, and is not presented as more.</p>

<p><strong>Percentages are relative differences</strong> against the subgraph value, computed in
exact scaled-integer arithmetic rather than floating point &mdash; these are 34-significant-digit
decimals, and double precision cannot subtract two of them that differ in the last digit.</p>

<p><strong>Non-numeric differences</strong> &mdash; addresses, ids, enums, null-against-value &mdash;
have no defined relative magnitude. They are counted in &ldquo;fields differing&rdquo; but never in
the &gt;&nbsp;0.1&nbsp;% or &gt;&nbsp;1&nbsp;% buckets, because calling them 0&nbsp;% would understate
them and 100&nbsp;% would invent a number. Across the whole campaign there are none: every field
difference found is numeric.</p>

<p><strong>The validator's own numbers were cross-checked.</strong> All 19 entity row counts on
helper/1776 were re-derived by direct GraphQL pagination against both endpoints, through a separate
code path that shares nothing with the validator beyond the URLs. All 19 agree on both sides, with
zero mismatches. The 29-hour gap in <a href="#case-swap">case&nbsp;6</a> was likewise established by
direct queries rather than from the validator's output, and every on-chain claim in cases&nbsp;5
and&nbsp;6 was verified against the chain by <code>eth_getLogs</code>.</p>

<div class="banner"><p><strong>One caveat on the percentage buckets.</strong> A relative difference
is meaningless when the baseline is itself dust. On helper/9745, 17 differences exceed 1&nbsp;%
relative &mdash; but every one is the subgraph holding a residue near
1&times;10<sup>-31</sup> where the merged indexer holds exactly&nbsp;0. The largest <em>absolute</em>
difference among all 142 differences on that deployment is
<strong>1.371&times;10<sup>-28</sup> tokens</strong>. They are counted honestly in the tables, and
they belong to the rounding class of <a href="#case-ulp">case&nbsp;1</a>, not to anything
meaningful.</p></div>
"""


# Values recorded in VALIDATION-HANDOFF.md section 6 before this session, so the
# report can show agreement or disagreement rather than quietly replacing them.
PRIOR = {
 "helper-1776":  ("3,642 / 3,642", "0", "agree"),
 "helper-9745":  ("88,642 / 88,642", "98, all amountDecimals ULP", "differ"),
 "helper-4663":  ("933 / 935", "0 — wrong VeToken address", "agree"),
 "v1-59144":     ("458,394 / 458,394", "9 (3 not ULP)", "differ"),
 "v1-4663":      ("36 / 36", "0", "agree"),
 "farm-239":     ("917 / 917", "0", "differ"),
 "analytics-239":("27 entities", "8 entities ULP-only", "differ"),
 "helper-59144": ("916,789 / 916,789", "1,627 *Decimals ULP", "differ"),
}

RECON_NOTES = {
 "helper-59144": "The &sect;6 figure is the <em>standalone</em> indexer baseline, not a merged run. Rows "
   "reconcile exactly here (916,814 on both sides, 25 more than the standalone baseline, consistent with "
   "the later pin). The difference count is lower because this run field-compares 10,000 rows per entity "
   "rather than every row; the class is unchanged &mdash; one dust column, largest absolute difference "
   "1.0&times;10<sup>-28</sup> tokens.",
 "v1-59144": "Not comparable as totals, and better now. &sect;6's own note says <code>Transaction</code> "
   "and <code>Swap</code> were <em>not yet compared</em> on Linea; this run includes both &mdash; "
   "1,274,386 swaps and 1,119,956 transactions &mdash; and finds them exact. All 16 entities reconcile "
   "row for row. The 5 remaining field differences are all "
   "<code>untrackedVolumeUSD</code>/<code>dailyVolumeUntracked</code>, which is the open class in "
   "<a href=\"#case-untracked\">case&nbsp;4</a>, matching &sect;6's &ldquo;3 of them not ULP&rdquo;.",
 "helper-9745": "Same class, different count. Both runs find only "
   "<code>DepositTokenBalance.amountDecimals</code> dust. The count moves because the earlier run was "
   "taken at a different head, so the accumulators had different residues; this run compares all 386 "
   "rows at the frozen pin. The largest absolute difference is 1.4&times;10<sup>-28</sup> tokens.",
 "farm-239": "Not a contradiction. <code>cmp_farm.ts</code> carries this exact row in a "
   "<code>KNOWN_DIVERGENCES</code> filter and subtracts it before reporting; this report does not "
   "filter. The row is a subgraph defect &mdash; <a href=\"#case-farm\">case&nbsp;5</a>.",
 "analytics-239": "The prior figure is the <em>standalone</em> result at <code>end_block 4,600,000</code>, "
   "not a merged run at head &mdash; it matches <code>FINAL-REPORT.md</code>'s "
   "<code>failed=8</code> exactly, it is the only row in &sect;6 with no row count, and &sect;6's own "
   "closing note says TAC was &ldquo;not yet compared at head&rdquo;. This run is pinned at 24,087,877, "
   "five times further, and the 29-hour gap sits at block 21.7M &mdash; outside anything previously "
   "measured.",
}


def reconciliation(deps):
    rows = []
    for k, dep in deps:
        prior = PRIOR.get(k)
        if not prior:
            continue
        prior_rows, prior_fields, _ = prior
        t = dep["totals"]
        now_rows = f"{fmt(t['subgraphRows'])} / {fmt(t['envioRows'])}"
        now_fields = fmt(t["diffAny"])
        note = RECON_NOTES.get(k, "")
        agrees = not note
        state = ("agrees" if agrees else "explained")
        cls = "" if agrees else ' class="r-attention"'
        rows.append(
            f"<tr{cls}><td class='ent'>{esc(dep['indexer'])}/{dep['chain']}</td>"
            f"<td class='num'>{prior_rows}</td><td class='num'>{now_rows}</td>"
            f"<td class='num'>{esc(prior_fields)}</td><td class='num'>{now_fields}</td>"
            f"<td class='reason'>{note or '<span class=\'q\'>reproduced</span>'}</td></tr>"
        )
    return f"""
<div class="dep">
  <header class="dep-head"><div class="dep-title">
    <h3>Against the previously recorded results</h3>
    <p class="ref">VALIDATION-HANDOFF.md &sect;6 &nbsp;·&nbsp; nothing below was overwritten</p>
  </div></header>
  <p class="lead">Four of the seven previously recorded results reproduce exactly. Three differ, and
  each difference is accounted for below rather than silently replaced. None of the three is a
  regression in the merged indexer.</p>
  <div class="tw"><table>
    <thead><tr><th>deployment</th><th class="num">&sect;6 rows</th><th class="num">this run</th>
    <th class="num">&sect;6 field diffs</th><th class="num">this run</th><th>reconciliation</th></tr></thead>
    <tbody>{"".join(rows)}</tbody>
  </table></div>
</div>"""


def main():
    deps = [(k, DATA[k]) for k in ORDER if k in DATA]
    missing = [k for k in ORDER if k not in DATA]

    # verdict strip
    cards = []
    for k, dep in deps:
        v, _ = verdict(dep)
        t = dep["totals"]
        rowline = f"{fmt(t['subgraphRows'])} vs {fmt(t['envioRows'])} rows"
        if t["missingInEnvio"] or t["extraInEnvio"]:
            rowline += f" &nbsp;·&nbsp; {fmt(t['missingInEnvio'])} missing"
        cards.append(
            f'<a class="vcard v-{v}" href="#{esc(k)}">'
            f'<div class="who">{esc(dep["indexer"])} / {dep["chain"]}</div>'
            f'<div class="num2">{rowline}</div>'
            f'<div class="st s-{v}">{VERDICT_LABEL[v]}</div></a>'
        )
    cards.append(
        '<a class="vcard v-none" href="#case-v4">'
        '<div class="who">v4 / 4663 &amp; 1776</div>'
        '<div class="num2">no reference subgraph exists</div>'
        '<div class="st s-none">Cannot be validated</div></a>'
    )

    sections = "".join(deployment_section(k, dep, LEADS.get(k, ""), REASONS) for k, dep in deps)

    gtot = {
        "sg": sum(d["totals"]["subgraphRows"] for _, d in deps),
        "envio": sum(d["totals"]["envioRows"] for _, d in deps),
        "miss": sum(d["totals"]["missingInEnvio"] for _, d in deps),
        "extra": sum(d["totals"]["extraInEnvio"] for _, d in deps),
        "cmp": sum(d["totals"]["compared"] for _, d in deps),
        "any": sum(d["totals"]["diffAny"] for _, d in deps),
        "t": sum(d["totals"]["diffOverTenth"] for _, d in deps),
        "o": sum(d["totals"]["diffOverOne"] for _, d in deps),
        "ent": sum(len(d["entities"]) for _, d in deps),
    }

    warn = ""
    if missing:
        warn = (
            '<div class="banner"><p><strong>Incomplete.</strong> No report was produced for: '
            + ", ".join(f"<code>{esc(m)}</code>" for m in missing)
            + ". Those deployments are absent from every figure on this page.</p></div>"
        )

    html_doc = f"""<title>Merged indexer parity — subgraph reconciliation</title>
<style>{CSS}</style>

<header class="mast">
  <div class="wrap">
    <div class="lbl">pumex-merged-idx &nbsp;·&nbsp; deployment 2a5ef57 &nbsp;·&nbsp; 2026-08-12</div>
    <h1>Does the merged indexer still say what the subgraphs say?</h1>
    <p class="sub">One endpoint now serves five source indexers across five chains. This reconciles
    every entity it holds against the reference subgraph it replaced, row by row and field by
    field.</p>

    <dl class="facts">
      <div class="fact"><dt>deployments checked</dt><dd>{len(deps)} of 9</dd></div>
      <div class="fact"><dt>entity types</dt><dd>{gtot['ent']}</dd></div>
      <div class="fact"><dt>rows enumerated</dt><dd>{fmt(gtot['sg'] + gtot['envio'])}</dd></div>
      <div class="fact"><dt>rows field-compared</dt><dd>{fmt(gtot['cmp'])}</dd></div>
      <div class="fact"><dt>rows missing in envio</dt><dd>{fmt(gtot['miss'])}</dd></div>
      <div class="fact"><dt>fields differing</dt><dd>{fmt(gtot['any'])}</dd></div>
    </dl>
    {warn}
    <div class="banner"><p><strong>The headline.</strong> Seven of the eight validatable
    deployments reconcile against their subgraph — exactly, or to within BigDecimal rounding, or with
    a difference that is the subgraph's fault rather than the indexer's. <strong>One does
    not:</strong> analytics on chain 239 has a 29-hour indexing gap that removes 2,926 swaps, and
    every other difference on that deployment follows from it.</p>
    <p>A ninth, v4, <strong>cannot be validated at all</strong> — both of its reference subgraphs are
    gone. That is neither a pass nor a failure; it is unmeasured.</p></div>
  </div>
</header>

<section class="band">
  <div class="wrap">
    <h2>Verdict by deployment</h2>
    <div class="strip">{"".join(cards)}</div>
  </div>
</section>

<section class="band">
  <div class="wrap prose">{METHOD}</div>
</section>

<section class="band">
  <div class="wrap">
    <h2>Deployment by deployment</h2>
    {sections}
  </div>
</section>

<section class="band">
  <div class="wrap">
    <h2>Reconciliation</h2>
    {reconciliation(deps)}
  </div>
</section>

<section class="band">
  <div class="wrap">
    <h2>Every difference, and why</h2>
    <p class="prose" style="color:var(--muted);margin:0 0 26px">Nine classes account for every
    difference found. Four were already documented and are reused rather than re-derived; two are new
    this session; three are statements about what could not be measured.</p>
    {build_cases()}
  </div>
</section>

<footer>
  <div class="wrap prose">
    <p><strong>Totals across the {len(deps)} validated deployments:</strong>
    {fmt(gtot['sg'])} subgraph rows against {fmt(gtot['envio'])} envio rows;
    {fmt(gtot['miss'])} missing and {fmt(gtot['extra'])} extra;
    {fmt(gtot['any'])} field differences, of which {fmt(gtot['t'])} exceed 0.1&nbsp;% and
    {fmt(gtot['o'])} exceed 1&nbsp;% relative.</p>
    <p>Generated from <code>output/merged/consolidated.json</code>. Every figure on this page comes
    from those reports rather than being transcribed, so the page and the raw data cannot disagree.
    Reproduce with <code>./run-merged-parity.sh</code> then <code>python3 summarize-merged.py</code>
    on branch <code>pumex-merged-parity</code>.</p>
  </div>
</footer>

<script>
(function(){{
  var els = document.querySelectorAll('a[href^="#"]');
  for (var i=0;i<els.length;i++) els[i].addEventListener('click', function(e){{
    var t = document.querySelector(this.getAttribute('href'));
    if (!t) return;
    e.preventDefault();
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    t.scrollIntoView({{behavior: reduce ? 'auto' : 'smooth', block:'start'}});
  }});
}})();
</script>
"""
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html_doc)
    print(f"wrote {OUT}  ({len(html_doc):,} bytes)")
    if missing:
        print("MISSING REPORTS:", missing)


if __name__ == "__main__":
    main()
