// Token Radar dashboard: renders window.RADAR (written by main.ts from the sealed snapshot).
// No fetch, no network. Search, filter and sort run here, in the page. The farm plan is generated
// here from the row's own record, by the same rules as lib/model.ts farmSteps: capital from TVL,
// hold from age, the action from the category — never from a hand-written list of names. Steps
// that depend on something the snapshot does not show are conditional, costs are assumed budgets,
// and nothing promises eligibility or a reward. This file must produce byte-identical steps to
// lib/model.ts farmSteps for the same row.
(function () {
  'use strict';
  var R = window.RADAR;
  var boardEl = document.querySelector('#board tbody');
  var liveEl = document.querySelector('#live tbody');
  if (!R || !R.rows) {
    document.querySelector('main').insertAdjacentHTML('afterbegin',
      '<section class="card"><h2>No data</h2><p>The dashboard found no data.js. Run main.ts first.</p></section>');
    return;
  }

  // ---------------------------------------------------------------- formatting
  function money(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  }
  function moneyFull(n) {
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    var s = (n > 0 ? '+' : '') + n.toFixed(1) + '%';
    return '<span class="' + (n > 0 ? 'pos' : n < 0 ? 'neg' : '') + '">' + s + '</span>';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function ageText(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days < 30) return days + 'd';
    if (days < 365) return Math.round(days / 30) + 'mo';
    return (days / 365).toFixed(1) + 'y';
  }

  // ---------------------------------------------------------------- farm plan (mirrors lib/model.ts)
  function capitalFor(tvl) {
    if (tvl >= 5e9) return 250;
    if (tvl >= 1e9) return 150;
    if (tvl >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(row, capital, chain) {
    var c = (row.category || '').toLowerCase();
    var name = row.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0)
      return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0)
      return 'Provide $' + capital + ' of liquidity to ' + name + '\'s main pool on ' + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0)
      return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0)
      return 'Stake $' + capital + ' of the chain\'s staking asset through ' + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0)
      return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0)
      return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0)
      return 'Deposit $' + capital + ' into a vault managed by ' + name + ' on ' + chain + ' and keep the shares. The deposit goes to the vault, not to ' + name + ' itself, and does not by itself earn eligibility for any token ' + name + ' may issue.';
    if (c.indexOf('stable') >= 0)
      return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0)
      return 'Mint $' + capital + ' of the protocol\'s yield asset on ' + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0)
      return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function farmSteps(row) {
    var chain = row.chains && row.chains.length ? row.chains[0] : 'its main chain';
    var capital = capitalFor(row.tvl_usd);
    var hold = holdDaysFor(row.age_days);
    var gas = capital >= 150 ? 8 : 4;
    var action = actionFor(row, capital, chain);
    var actionLower = action.charAt(0).toLowerCase() + action.slice(1);
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'assumed budget under $3 of gas for the first transaction (not a verified fee)', time: '5 minutes' },
      { text: 'First verify on ' + row.name + '\'s official interface that it supports this action on ' + chain + ' — the snapshot does not confirm the interface, the asset, the network or any minimum. If it does, ' + actionLower, cost: '$' + capital + ' of capital (assumed budget) and about $' + gas + ' of gas (assumed, not verified)', time: '15 minutes to set up' },
      { text: 'If the protocol runs a rewards or points program — check its official pages first, because the snapshot does not say it does — consider one small action a week, such as a deposit, a borrow, a swap or a vote. There is no snapshot evidence that weekly actions change eligibility.', cost: 'assumed budget about $2 of gas a week (not a verified fee)', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days as a long-hold scenario. The snapshot does not prove a longer hold changes eligibility, and age is not proof of a qualifying duration — treat this as an untested assumption.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Before you withdraw, check whether the protocol publishes a points or rewards page, and claim only from a link it publishes. Claiming itself may cost network gas; the snapshot carries no fee figures.', cost: 'no fee to check; claiming may cost gas (amount unverified)', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
      { text: 'Assumptions: $' + capital + ' of capital (assumed budget — TVL does not prove a minimum), about $' + gas + ' of gas to enter (assumed, not verified), a ' + hold + '-day hold (scenario — age does not prove a qualifying duration), on a protocol with $' + Math.round(row.tvl_usd / 1e6) + 'M of TVL. Nothing here promises eligibility, a points program or a reward. This entry never executes transactions; every step is a scenario to check, not an instruction to transact.', cost: 'no extra cost', time: 'read this before you start' }
    ];
    return steps.map(function (s) {
      var t = s.text + ' Cost: ' + s.cost + '. Time: ' + s.time + '.';
      if (t.length > 600) t = t.slice(0, 596) + '...';
      return t;
    });
  }

  // ---------------------------------------------------------------- header + controls
  document.getElementById('as-of').textContent = 'Snapshot ' + R.as_of;
  document.getElementById('coverage').innerHTML =
    R.board_size + ' ranked &middot; ' + R.watchlist_size + ' watchlist + ' + R.early_size + ' early';
  var cats = [];
  R.rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  var catSel = document.getElementById('cat');
  cats.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c + ' (' + R.rows.filter(function (r) { return r.category === c; }).length + ')';
    catSel.appendChild(o);
  });

  var params = new URLSearchParams(window.location.search);
  var qEl = document.getElementById('q');
  var scopeEl = document.getElementById('scope');
  var sortEl = document.getElementById('sort');
  if (params.get('q')) qEl.value = params.get('q');
  if (params.get('cat')) catSel.value = params.get('cat');
  if (params.get('scope')) scopeEl.value = params.get('scope');
  if (params.get('sort')) sortEl.value = params.get('sort');

  function visibleRows() {
    var q = qEl.value.trim().toLowerCase();
    var cat = catSel.value;
    var scope = scopeEl.value;
    var rows = R.rows.filter(function (r) {
      if (scope === 'watchlist' && !r.watchlist) return false;
      if (scope === 'early' && r.watchlist) return false;
      if (cat && r.category !== cat) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var sort = sortEl.value;
    rows.sort(function (a, b) {
      if (sort === 'tvl') return b.tvl_usd - a.tvl_usd || a.rank - b.rank;
      if (sort === 'growth') return (b.change_7d === null ? -1e9 : b.change_7d) - (a.change_7d === null ? -1e9 : a.change_7d) || a.rank - b.rank;
      if (sort === 'age') return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days) || a.rank - b.rank;
      if (sort === 'name') return a.name < b.name ? -1 : a.name > b.name ? 1 : a.rank - b.rank;
      return b.implied_value_usd - a.implied_value_usd || a.rank - b.rank;
    });
    return rows;
  }

  function renderBoard() {
    var rows = visibleRows();
    document.getElementById('count').textContent = rows.length + ' of ' + R.rows.length + ' rows';
    boardEl.innerHTML = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span>' +
        (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') +
        (r.sparse_support ? '<span class="badge sparse">SPARSE SUPPORT</span>' : '') + '</td>' +
        '<td class="wrap">' + esc(r.category || '—') + '</td>' +
        '<td class="wrap">' + esc((r.chains || []).slice(0, 2).join(', ') || '—') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num">&times;' + r.multiple.toFixed(2) + '</td>' +
        '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td></tr>';
    }).join('');
  }

  // ---------------------------------------------------------------- detail view
  var detailWrap = document.getElementById('detail-wrap');
  var detailEl = document.getElementById('detail');
  function openDetail(slug) {
    var r = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) { r = R.rows[i]; break; }
    if (!r) return;
    var growth = r.change_7d === null ? 0 : Math.min(120, Math.max(-60, r.change_7d));
    var steps = farmSteps(r);
    detailEl.innerHTML =
      '<div class="detail-head"><h2>#' + r.rank + ' — ' + esc(r.name) + '</h2>' +
      '<button class="close" id="detail-close">Close detail</button></div>' +
      '<p class="hint">' + esc(r.slug) + ' &middot; ' + esc(r.category || 'uncategorised') + ' &middot; ' +
      esc((r.chains || []).join(', ') || 'no chain listed') + (r.watchlist ? ' &middot; on the watchlist' : ' &middot; early row, below the floor') + '</p>' +
      '<div class="kv">' +
      '<div><div class="k">Implied value</div><div class="v">' + money(r.implied_value_usd) + '</div><div class="s">model radar-2</div></div>' +
      '<div><div class="k">TVL</div><div class="v">' + money(r.tvl_usd) + '</div><div class="s">sealed snapshot</div></div>' +
      '<div><div class="k">Multiple</div><div class="v">&times;' + r.multiple.toFixed(2) + '</div><div class="s">size-fitted, TVL ' + money(r.tvl_usd) + '</div></div>' +
      '<div><div class="k">7-day growth</div><div class="v">' + (r.change_7d === null ? 'n/a' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</div><div class="s">clamped to ' + growth.toFixed(1) + '%</div></div>' +
      '<div><div class="k">Age</div><div class="v">' + ageText(r.age_days) + '</div><div class="s">' + (r.listed_at ? 'tracked since ' + r.listed_at + ' — time tracked by DefiLlama, proxy only' : 'first seen unknown — age imputed as 365 days') + '</div></div>' +
      '</div>' +
      '<p class="why"><strong>Why rank #' + r.rank + ':</strong> ' + moneyFull(r.tvl_usd) + ' of TVL at a fitted ' +
      'multiple of &times;' + r.multiple.toFixed(2) + ' (small protocols trade at higher multiples of TVL than ' +
      'large ones in this snapshot), times a growth multiplier of ' + r.growth_multiplier.toFixed(2) + ' and a ' +
      'maturity multiplier of ' + r.maturity_multiplier.toFixed(2) + ' (' + ageText(r.age_days) + ' time tracked; ' +
      'the current snapshot records no token; unknown age uses imputation) gives ' + moneyFull(r.implied_value_usd) +
      '. That is the board&rsquo;s own claim, a proxy — not a ' +
      'valuation, and not a prediction that a token will launch.</p>' +
      '<p class="conf-note">' + (r.sparse_support
        ? '<strong>Sparse category support:</strong> this protocol&rsquo;s category has only ' + r.category_comps + ' launch-comparable comp' + (r.category_comps === 1 ? '' : 's') + ' (fewer than 4), so the fitted multiple is extrapolated here with no category-level check. Treat the implied value as a rough ordering signal, not a valuation. The tag is a count label, not a calibrated probability.'
        : '<strong>Checked, not guaranteed:</strong> this protocol&rsquo;s category has ' + r.category_comps + ' launch-comparable comps and was checked leave-one-category-out. Four or more comps is not high confidence — the typical error across the board is still a factor of about 3.') + '</p>' +
      '<h3>Farm plan — 7 steps</h3>' +
      '<ol class="steps">' + steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="fine">Notes: capital and gas are assumed budgets; the hold is an untested scenario; nothing here promises eligibility, a points program or a reward. This entry never executes transactions.</p>';
    detailWrap.hidden = false;
    document.getElementById('detail-close').addEventListener('click', function () {
      detailWrap.hidden = true;
      var sel = boardEl.querySelector('tr.selected');
      if (sel) sel.classList.remove('selected');
    });
    var prev = boardEl.querySelector('tr.selected');
    if (prev) prev.classList.remove('selected');
    var tr = boardEl.querySelector('tr[data-slug="' + slug + '"]');
    if (tr) tr.classList.add('selected');
  }
  boardEl.addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });

  // ---------------------------------------------------------------- live view
  liveEl.innerHTML = R.live.map(function (p) {
    var ratio = (p.mcap_usd && p.tvl_usd) ? (p.mcap_usd / p.tvl_usd) : null;
    return '<tr><td><span class="pname">' + esc(p.name) + '</span><br><span class="slug">' + esc(p.slug) + '</span></td>' +
      '<td>' + esc(p.category || '—') + '</td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td>' +
      '<td class="num">' + (p.mcap_usd ? money(p.mcap_usd) : '—') + '</td>' +
      '<td class="num">' + (ratio === null ? '—' : '&times;' + ratio.toFixed(2)) + '</td>' +
      '<td class="num">' + pct(p.change_7d) + '</td></tr>';
  }).join('');

  // ---------------------------------------------------------------- wire up + initial state
  [qEl, catSel, scopeEl, sortEl].forEach(function (el) {
    el.addEventListener('input', renderBoard);
    el.addEventListener('change', renderBoard);
  });
  renderBoard();
  if (params.get('view') === 'detail' && params.get('slug')) openDetail(params.get('slug'));
})();
