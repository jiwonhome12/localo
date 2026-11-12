/* 로컬로 웹앱 — 지도 API 없이 행정경계 SVG로 그린 반값여행 지도
   data/geo.json          : 시군구 경계 경로(crawler/build_geo.py 로 생성)
   data/regions.json      : 25개 지역 신청 상태·환급 규칙(scripts/build_data.py 가 수집 시트에서 생성)
   data/places.json       : 식당·카페는 수집 시트 실데이터, 숙박·관광지는 아직 예시(sample:true) */
(async function () {
  const $ = (id) => document.getElementById(id);
  const svg = $('svg'), overlay = $('overlay'), wrap = $('mapwrap');
  const NS = 'http://www.w3.org/2000/svg';
  const mobile = () => matchMedia('(max-width:1023px)').matches;
  const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const [GEO, REG, PLACES] = await Promise.all(
    ['data/geo.json', 'data/regions.json', 'data/places.json'].map((u) => fetch(u).then((r) => r.json()))
  );

  const ICON = {
    open: '<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2" y="2" width="12" height="12" rx="3"/><path d="M5.5 10.5l.4-1.8L10 4.6l1.4 1.4-4.1 4.1z" stroke-linejoin="round"/></svg>',
    soon: '<svg class="ic" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M8 4.5V8l2.3 1.4" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>',
    closed: '<svg class="ic" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="7" width="10" height="7.5" rx="2"/><path d="M5.2 7V5.4a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  };
  const STL = { open: '신청접수중', soon: '준비중', closed: '마감' };
  const CAT = {
    food: { n: '식당', c: 'var(--c-food)', k: '식' }, stay: { n: '숙박', c: 'var(--c-stay)', k: '숙' },
    cafe: { n: '카페', c: 'var(--c-cafe)', k: '카' }, spot: { n: '관광지', c: 'var(--c-spot)', k: '관' },
  };
  const SIDO_ORDER = ['강원', '충북', '충남', '경북', '경남', '전북', '전남'];

  // 지역 = 상태 + 지리 정보
  const R = REG.map((r) => ({ ...r, ...GEO.regions[r.id], short: r.name.slice(0, -1), name: r.name, sido: r.sido }));
  const RM = Object.fromEntries(R.map((r) => [r.id, r]));
  const PM = Object.fromEntries(PLACES.map((p) => [p.id, p]));
  const placesOf = (rid) => PLACES.filter((p) => p.region_id === rid);
  $('checked').textContent = (REG[0].status_checked_at || '').split(' ')[0];

  const VB0 = GEO.viewBox.slice();
  let vb = VB0.slice();
  const S = { view: 'all', rid: null, cat: 'all', pid: null, filter: 'all', people: 2, mode: 'normal', cart: [], route: null, basket: 'all' };

  /* ───────── SVG 그리기 ───────── */
  const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const targetCodes = new Set(R.map((r) => r.code));
  GEO.munis.forEach((m) => { if (!targetCodes.has(m.code)) $('g-munis').appendChild(el('path', { d: m.d, class: 'muni' })); });
  GEO.provinces.forEach((p) => $('g-prov').appendChild(el('path', { d: p.d, class: 'prov' })));
  // 마감 → 준비중 → 접수중 순으로 그려 접수중 지역이 위에 오게
  const ORDER = { closed: 0, soon: 1, open: 2 };
  [...R].sort((a, b) => ORDER[a.status] - ORDER[b.status]).forEach((r) => { const p = el('path', { d: r.d, class: 'target st-' + r.status, 'data-r': r.id }); $('g-targets').appendChild(p); r.el = p; });
  const deco = $('g-deco');
  [['동 해', 395, 250], ['서 해', 8, 300], ['남 해', 300, 520]].forEach(([t, x, y]) => { const s = el('text', { x, y, class: 'sea' }); s.textContent = t; deco.appendChild(s); });
  const [ix0, iy0, ix1, iy1] = GEO.inset;
  deco.appendChild(el('rect', { x: ix0, y: iy0, width: ix1 - ix0, height: iy1 - iy0, rx: 4, class: 'inset-box' }));
  const it = el('text', { x: ix0 + 4, y: iy1 - 4, class: 'inset-t' }); it.textContent = '울릉도·독도'; deco.appendChild(it);
  svg.addEventListener('click', (e) => { const t = e.target.closest('.target'); if (t) openRegion(t.dataset.r); });

  /* ───────── 좌표 변환 ───────── */
  function proj(x, y) {
    const w = wrap.clientWidth, h = wrap.clientHeight, s = Math.min(w / vb[2], h / vb[3]);
    return [(w - vb[2] * s) / 2 + (x - vb[0]) * s, (h - vb[3] * s) / 2 + (y - vb[1]) * s, s];
  }
  function setVB(v) { vb = v; svg.setAttribute('viewBox', v.join(' ')); placeOverlay(); }
  let anim = null;
  function animateVB(to, ms = 650, done) {
    cancelAnimationFrame(anim);
    const from = vb.slice(), t0 = performance.now();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setVB(to); done && done(); return; }
    const step = (t) => { let k = Math.min(1, (t - t0) / ms); k = 1 - Math.pow(1 - k, 3);
      setVB(from.map((f, i) => f + (to[i] - f) * k)); if (k < 1) anim = requestAnimationFrame(step); else done && done(); };
    anim = requestAnimationFrame(step);
  }
  // 지역 경계 상자에 맞춰 확대 (화면 비율 유지)
  function fitBox([x0, y0, x1, y1], pad = 0.28) {
    const w = wrap.clientWidth || 1, h = wrap.clientHeight || 1;
    let bw = (x1 - x0) * (1 + pad * 2), bh = (y1 - y0) * (1 + pad * 2);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 - (mobile() ? 0 : 0);
    if (bw / bh > w / h) bh = bw * h / w; else bw = bh * w / h;
    return [cx - bw / 2, cy - bh / 2 - bh * 0.04, bw, bh];
  }

  /* ───────── 지도 위 HTML(핀·라벨·마커) ───────── */
  let pinOffsets = {}; // 전국 화면 라벨 겹침 해소 결과 (px)
  function renderOverlay() {
    let h = '<svg class="leaders" id="leaders"></svg>';
    if (S.view === 'all') {
      R.forEach((r, i) => {
        if (S.filter !== 'all' && r.status !== S.filter) return;
        const d = (2.15 + i * 0.03).toFixed(2);
        h += `<span class="pdot ${r.status}" data-r="${r.id}" style="animation-delay:${d}s"></span>`;
        h += `<button type="button" class="pin hit ${r.status}" data-r="${r.id}" style="animation-delay:${d}s" aria-label="${r.name} ${STL[r.status]}">${ICON[r.status]}${r.short}${r.tour_resident_card ? '<sup>★</sup>' : ''}</button>`;
      });
    } else {
      const r = RM[S.rid];
      GEO.munis.forEach((m) => { if (m.code !== r.code) h += `<span class="nlabel" data-x="${m.cx}" data-y="${m.cy}">${m.name}</span>`; });
      h += `<span class="rlabel" data-x="${r.cx}" data-y="${r.cy}">${r.short}</span>`;
      placesOf(r.id).forEach((p) => {
        if (S.cat !== 'all' && p.category !== S.cat) return;
        const inCart = S.cart.some((c) => c.pid === p.id);
        const ord = S.route ? S.route.indexOf(p.id) : -1;
        h += `<button type="button" class="marker hit${S.pid === p.id ? ' on' : ''}${inCart ? ' in-cart' : ''}" data-p="${p.id}" aria-label="${esc(p.name)}">${ord >= 0 ? `<span class="ord">${ord + 1}</span>` : ''}<span class="mk" style="background:${CAT[p.category].c}"><i>${CAT[p.category].k}</i></span><span class="ml">${esc(p.name.replace(r.short + ' ', ''))}</span></button>`;
      });
      if (S.pid) h += popHTML(PM[S.pid]);
    }
    overlay.innerHTML = h;
    if (S.view === 'all') layoutPins();
    placeOverlay();
  }
  // 라벨끼리 겹치지 않게 밀어내고, 많이 움직인 라벨은 지시선을 그린다
  function layoutPins() {
    const vb0 = vb; vb = VB0; // 전국 화면 기준으로 계산
    const items = [...overlay.querySelectorAll('.pin')].map((b) => {
      const r = RM[b.dataset.r]; const [x, y] = proj(r.cx, r.cy);
      return { id: r.id, ax: x, ay: y, x, y: y - 16, w: b.offsetWidth + 4, h: b.offsetHeight + 4 };
    });
    const W = wrap.clientWidth, H = wrap.clientHeight;
    for (let it = 0; it < 140; it++) {
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        const ox = (a.w + b.w) / 2 - Math.abs(a.x - b.x), oy = (a.h + b.h) / 2 - Math.abs(a.y - b.y);
        if (ox > 0 && oy > 0) {
          if (ox < oy * 1.6) { const s = (a.x < b.x ? -1 : 1) * ox / 2; a.x += s; b.x -= s; }
          else { const s = (a.y < b.y ? -1 : 1) * oy / 2; a.y += s; b.y -= s; }
        }
      }
      items.forEach((a) => { a.x += (a.ax - a.x) * 0.03; a.y += (a.ay - 16 - a.y) * 0.03;
        a.x = Math.max(a.w / 2 + 6, Math.min(W - a.w / 2 - 6, a.x)); a.y = Math.max(60, Math.min(H - 40, a.y)); });
    }
    pinOffsets = Object.fromEntries(items.map((a) => [a.id, [a.x - a.ax, a.y - a.ay]]));
    vb = vb0;
  }
  function placeOverlay() {
    const L = overlay.querySelector('#leaders'); let lines = '';
    overlay.querySelectorAll('.pdot').forEach((e) => { const r = RM[e.dataset.r]; const [x, y] = proj(r.cx, r.cy); e.style.left = x + 'px'; e.style.top = y + 'px'; });
    overlay.querySelectorAll('.pin').forEach((e) => {
      const r = RM[e.dataset.r]; const [x, y] = proj(r.cx, r.cy); const o = pinOffsets[r.id] || [0, -16];
      e.style.left = x + o[0] + 'px'; e.style.top = y + o[1] + 'px';
      if (Math.hypot(o[0], o[1]) > 20) lines += `<line x1="${x}" y1="${y}" x2="${x + o[0]}" y2="${y + o[1]}"/>`;
    });
    if (L) L.innerHTML = lines;
    overlay.querySelectorAll('.nlabel,.rlabel').forEach((e) => { const [x, y] = proj(+e.dataset.x, +e.dataset.y); e.style.left = x + 'px'; e.style.top = y + 'px'; });
    overlay.querySelectorAll('.marker').forEach((e) => { const p = PM[e.dataset.p]; const [x, y] = proj(p.x, p.y); e.style.left = x + 'px'; e.style.top = y + 'px'; });
    const pop = overlay.querySelector('.pop');
    if (pop && !mobile()) {
      const p = PM[pop.dataset.p]; const [x, y] = proj(p.x, p.y);
      const w = wrap.clientWidth, h = wrap.clientHeight, pw = pop.offsetWidth, ph = pop.offsetHeight;
      let L2 = x + 24, T = y - ph / 2;
      if (L2 + pw > w - 12) L2 = x - pw - 24;
      if (L2 < 12) { L2 = Math.max(12, Math.min(w - pw - 12, x - pw / 2)); T = y + 12 + ph < h ? y + 12 : y - ph - 44; }
      pop.style.left = L2 + 'px'; pop.style.top = Math.max(56, Math.min(h - ph - 8, T)) + 'px';
    }
  }
  const safeUrl = (u) => (/^https?:\/\//.test(u || '') ? esc(u) : '');
  function popHTML(p) {
    const r = RM[p.region_id], inCart = S.cart.some((c) => c.pid === p.id);
    const q = encodeURIComponent(r.name + ' ' + (p.sample ? CAT[p.category].n : p.name));
    const map = safeUrl(p.map_url) || `https://map.kakao.com/link/search/${q}`;
    const rows = p.sample
      ? `<dt>가격</dt><dd>${esc(p.price_text)}</dd><dt>접근성</dt><dd>${esc(p.access_text)}</dd>`
      : `<dt>대표 메뉴</dt><dd>${esc(p.price_text)}</dd><dt>주소</dt><dd>${esc(p.address || p.access_text)}</dd>
         ${p.rating ? `<dt>평점</dt><dd>${esc(p.rating)}</dd>` : ''}${p.reason ? `<dt>추천</dt><dd>${esc(p.reason)}</dd>` : ''}
         <dt>가맹점</dt><dd>${p.merchant === '예' ? '지역화폐 가맹점' : p.merchant === '아니오' ? '<b class="warn">가맹점 아님 · 환급 제외</b>' : '<span class="warn">확인 전</span>'}</dd>`;
    const notes = p.sample ? '장소·가격은 화면 설계용 예시입니다.'
      : [p.approx ? '지도 위치는 지역 안 근사 위치예요.' : '', p.merchant !== '예' ? '반값여행 환급은 지역화폐 가맹점 결제만 인정돼요.' : ''].filter(Boolean).join(' ');
    return `<div class="pop" data-p="${p.id}" role="dialog" aria-label="${esc(p.name)}">
      <button class="x" type="button" data-close aria-label="닫기">✕</button>
      <div class="cat-l" style="color:${CAT[p.category].c}">${CAT[p.category].n} · ${r.name}</div>
      <h3>${esc(p.name)}</h3>
      <dl>${rows}
      <dt>계산 단가</dt><dd class="num">${p.price ? won(p.price) + (p.category === 'stay' ? ' / 1박·객실' : ' / 1인') : '무료'}</dd></dl>
      <div class="links"><a href="${map}" target="_blank" rel="noopener">카카오맵에서 보기</a>${safeUrl(p.source_url) ? `<a href="${safeUrl(p.source_url)}" target="_blank" rel="noopener">출처</a>` : ''}${p.category === 'stay' ? '<span>예약 링크 (제휴 연동 예정)</span>' : ''}</div>
      <button class="btn${inCart ? ' added' : ''}" type="button" data-add="${p.id}">${inCart ? '담김 · 빼기' : '장바구니에 담기'}</button>
      ${notes ? `<div class="ex">${notes}</div>` : ''}</div>`;
  }

  /* ───────── 지도 상단 ───────── */
  function renderTop() {
    const t = $('maptop');
    if (S.view === 'all') { t.innerHTML = `<div class="crumb">반값여행 대상 <b class="num">${R.length}</b>곳 · 지역을 누르면 확대돼요</div>`; return; }
    const r = RM[S.rid];
    const cats = [['all', '전체'], ...Object.entries(CAT).map(([k, v]) => [k, v.n])];
    t.innerHTML = `<div class="crumb"><button type="button" data-home>전국</button> › <b>${r.sido} ${r.name}</b></div>
      <div class="cats">${cats.map(([k, n]) => `<button type="button" class="cat" data-cat="${k}" aria-pressed="${S.cat === k}">${k !== 'all' ? `<span class="sw" style="background:${CAT[k].c}"></span>` : ''}${n}</button>`).join('')}</div>`;
  }

  /* ───────── 왼쪽 탭(휴대폰: 아래 시트) ───────── */
  function silhouette(r) {
    const [x0, y0, x1, y1] = r.bbox, w = x1 - x0, h = y1 - y0, s = Math.max(w, h) * 1.08;
    return `<svg viewBox="${x0 + w / 2 - s / 2} ${y0 + h / 2 - s / 2} ${s} ${s}" aria-hidden="true"><path d="${r.d}"/></svg>`;
  }
  function geoFacts(r) {
    const f = [`면적 <b>${r.area_km2.toLocaleString()}㎢</b>`];
    f.push(r.coastal ? '바다와 맞닿은 <b>해안 지역</b>' : '바다가 없는 <b>내륙 지역</b>');
    if (r.parts > 1) f.push(`섬 <b>${r.parts - 1}개</b> 포함`);
    return f.map((x) => `<span class="fact">${x}</span>`).join('');
  }
  const brief = (s, n = 90) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  function capText(k) { return k.cap_1 == null || k.cap_group == null ? '확인 필요' : `1인 ${won(k.cap_1)} · 2인 이상 ${won(k.cap_group)}`; }
  function minText(m) { return !m ? '확인 필요' : m.per_person ? `1인당 ${won(m.one)}` : m.one === m.group ? `${won(m.one)} 이상` : `1인 ${won(m.one)} · 2인 이상 ${won(m.group)}`; }
  function regionInfo(r) {
    const k = r.rule, rows = [['현재 일정', r.round || r.period], ['사업 기간', r.period], ['환급 한도', `${capText(k)} (경비의 50%)`],
      ['최소 소비', minText(k.min_spend)], ['청년·가족', brief(r.perks_text) || '확인 필요'], ['환급 수단', r.currency], ['사전신청', brief(r.apply)]];
    return `<div class="src rinfo"><b>반값여행 신청 안내</b>
      <dl>${rows.filter((x) => x[1]).map(([t, d]) => `<dt>${t}</dt><dd>${esc(d)}</dd>`).join('')}</dl>
      확인일 ${esc(r.status_checked_at)} · 팀 수집 시트 기준, 최종 조건은 지자체 공고를 확인하세요.<br>
      ${safeUrl(r.site) ? `<a href="${safeUrl(r.site)}" target="_blank" rel="noopener">${r.name} 신청 페이지 열기 ›</a>` : ''}</div>`;
  }
  function renderLeft() {
    const L = $('left');
    if (S.view === 'all') {
      const f = [['all', '전체'], ['open', '신청접수중'], ['soon', '준비중'], ['closed', '마감']];
      let h = `<p class="p-title">지역별 진행 현황</p>
        <div class="legend">${f.map(([k, n]) => `<button type="button" class="chip" data-f="${k}" aria-pressed="${S.filter === k}">${k !== 'all' ? `<span class="dot ${k}"></span>` : ''}${n}</button>`).join('')}</div>
        <p class="note">예산 소진 시 조기 마감 · 상태는 ${$('checked').textContent} 확인 · 팀 수집 시트 기준</p>`;
      SIDO_ORDER.forEach((sd) => {
        const rs = R.filter((r) => r.sido === sd && (S.filter === 'all' || r.status === S.filter)); if (!rs.length) return;
        h += `<div class="rgroup">${sd}</div>` + rs.map((r) => `<button type="button" class="ritem" data-r="${r.id}"><span class="dot ${r.status}"></span><span class="nm">${r.name}</span>${r.tour_resident_card ? '<span class="star">★</span>' : ''}${r.half.includes('신규') ? '<span class="tag">하반기 신규</span>' : ''}<span class="st ${r.status}">${STL[r.status]}</span></button>`).join('');
      });
      L.innerHTML = h; return;
    }
    const r = RM[S.rid];
    const ps = placesOf(r.id).filter((p) => S.cat === 'all' || p.category === S.cat);
    const cats = [['all', '전체'], ...Object.entries(CAT).map(([k, v]) => [k, v.n])];
    L.innerHTML = `<button type="button" class="back" data-home>← 전국 지도</button>
      <div class="rcard"><div class="sil">${silhouette(r)}</div>
        <div><div class="rhead"><h2>${r.name}</h2><span class="pill ${r.status}">${STL[r.status]}</span></div>
        <div class="rsub">${r.sido} · ${r.half.includes('신규') ? '하반기 신규 지역' : '상반기부터 운영'}${r.tour_resident_card ? ' · <span class="star">★</span> 관광주민증 혜택' : ''}</div></div></div>
      <div class="facts">${geoFacts(r)}</div>
      ${regionInfo(r)}
      <div class="tabs" role="tablist">${cats.map(([k, n]) => `<button type="button" class="tab" role="tab" data-cat="${k}" aria-selected="${S.cat === k}">${n}</button>`).join('')}</div>
      <div>${ps.map((p) => `<button type="button" class="pitem${S.pid === p.id ? ' on' : ''}" data-p="${p.id}"><span class="pic" style="background:${CAT[p.category].c}">${CAT[p.category].k}</span><span><span class="nm">${esc(p.name.replace(r.short + ' ', ''))}</span><span class="sub">${p.price_text} · ${p.access_text}</span></span></button>`).join('')}</div>`;
  }
  // 장바구니는 '가는 지역'별 바구니로 나눈다
  const groups = () => { const g = {}; S.cart.forEach((c) => { const rid = PM[c.pid].region_id; (g[rid] = g[rid] || []).push(c); }); return g; };
  function renderTray() {
    const n = S.cart.length, G = groups(), rids = Object.keys(G);
    $('tray').innerHTML = `<div class="tray-h">지역별 장바구니 <span class="num">${rids.length}개 지역 · ${n}곳</span></div>` + (n
      ? `<div class="tray-list">${rids.map((rid) => `<div class="tgroup"><button type="button" class="tg-name${S.basket === rid ? '' : ' off'}" data-basket="${rid}">${RM[rid].short} ${G[rid].length}</button><div class="tg-list">${G[rid].map((c) => { const p = PM[c.pid]; return `<span class="tchip"><span class="dot" style="background:${CAT[p.category].c}"></span>${esc(p.name.replace(RM[rid].short + ' ', ''))}<button type="button" data-rm="${p.id}" aria-label="${esc(p.name)} 빼기">✕</button></span>`; }).join('')}</div></div>`).join('')}</div>`
      : `<div class="tray-empty">지역을 고르고 마음에 드는 장소를 담아 보세요. 지역마다 바구니가 따로 생겨요.</div>`);
    const b = $('badge'); b.hidden = !n; b.textContent = n;
  }

  /* ───────── 경비 계산 ───────── */
  function nights() { const n = Math.round((new Date($('d2').value) - new Date($('d1').value)) / 864e5); return isNaN(n) ? 1 : Math.max(0, n); }
  // 수량 = 인분·잔·매(식당·카페·관광지) / 객실 수(숙박). 인원을 바꾸면 수량도 같이 바뀐다.
  const UNIT = { food: '인분', cafe: '잔', spot: '매', stay: '실' };
  const roomsFor = (p, ppl) => Math.ceil(ppl / (p.capacity || 2));
  const defaultQty = (p) => (p.category === 'stay' ? roomsFor(p, S.people) : S.people);
  function lineCost(c) {
    const p = PM[c.pid];
    if (p.category === 'stay') { const n = Math.max(1, nights()); return { amt: p.price * n * c.qty, f: `1박 ${won(p.price)} × ${n}박 × 객실 ${c.qty}` }; }
    if (!p.price) return { amt: 0, f: `무료 · ${c.qty}${UNIT[p.category]}` };
    return { amt: p.price * c.qty, f: `${won(p.price)} × ${c.qty}${UNIT[p.category]}` };
  }
  function setPeople(n) {
    const old = S.people; S.people = Math.max(1, Math.min(10, n)); $('pp').textContent = S.people + '명';
    S.cart.forEach((c) => { const p = PM[c.pid];
      c.qty = p.category === 'stay' ? roomsFor(p, S.people) : Math.max(1, Math.round(c.qty * S.people / old)); });
    renderStack();
  }
  // 지역별 규칙(수집 시트 → regions.json rule): 일반 50%·지역 한도, 청년 70%·1인 14만(최대 2인), 가족 50%·1인 10만(최대 5인)
  const MODE = { normal: '일반', youth: '청년', family: '가족' };
  function rule(rid) {
    const k = RM[rid].rule, n = S.people, m = k.min_spend;
    const need = !m ? null : m.per_person ? m.one * n : n >= 2 ? m.group : m.one;
    const tag = (s) => (s === 'yes' ? '' : ' · 조건 확인 필요');
    if (S.mode === 'youth' && k.youth !== 'no') return { rate: 0.7, cap: 140000 * Math.min(n, k.youth_max || 2), need, label: '청년 70%' + tag(k.youth) };
    if (S.mode === 'family' && k.family !== 'no' && n >= 2) return { rate: 0.5, cap: 100000 * Math.min(n, 5), need, label: '가족 50%' + tag(k.family) };
    const why = S.mode === 'family' && n < 2 ? ' · 가족은 2인 이상' : S.mode !== 'normal' ? ' · 우대 없음' : '';
    return { rate: k.rate, cap: n >= 2 ? k.cap_group : k.cap_1, need, label: '일반 50%' + why };
  }
  function refundOf(rid, sub) {
    const ru = rule(rid);
    if (ru.cap == null) return { v: 0, ru, why: '한도 확인 필요' };
    if (ru.need != null && sub < ru.need) return { v: 0, ru, why: `최소 ${won(ru.need)} 미달` };
    return { v: Math.min(sub * ru.rate, ru.cap), ru, why: ru.need == null ? '최소 소비 확인 필요' : '' };
  }
  function cardHTML(c) {
    const p = PM[c.pid], l = lineCost(c);
    return `<div class="scard"><div class="h"><span class="pic" style="background:${CAT[p.category].c}">${CAT[p.category].k}</span><b>${esc(p.name)}</b><span class="amt num">${won(l.amt)}</span></div>
      <div class="f"><span class="num">${l.f}</span><span style="display:flex;align-items:center"><span class="mini"><button type="button" data-q="${p.id}" data-d="-1" aria-label="줄이기">−</button><span class="num">${c.qty}${UNIT[p.category]}</span><button type="button" data-q="${p.id}" data-d="1" aria-label="늘리기">+</button></span><button type="button" class="rm" data-rm="${p.id}">삭제</button></span></div></div>`;
  }
  function renderStack() {
    const G = groups(), rids = Object.keys(G);
    if (S.basket !== 'all' && !G[S.basket]) S.basket = rids.length ? rids[rids.length - 1] : 'all';
    const show = S.basket === 'all' ? rids : [S.basket];
    const tabs = rids.length ? `<div class="btabs">${rids.length > 1 ? `<button type="button" class="btab" data-basket="all" aria-pressed="${S.basket === 'all'}">전체 <span class="c">${S.cart.length}</span></button>` : ''}${rids.map((rid) => `<button type="button" class="btab" data-basket="${rid}" aria-pressed="${S.basket === rid}"><span class="dot ${RM[rid].status}"></span>${RM[rid].name} <span class="c">${G[rid].length}</span></button>`).join('')}</div>` : '';
    $('stack').innerHTML = rids.length ? tabs + show.map((rid) => {
      const sub = G[rid].reduce((s, c) => s + lineCost(c).amt, 0), rf = refundOf(rid, sub), r = RM[rid];
      return `<div class="bgroup"><div class="bg-h"><b>${r.name} 바구니</b><span class="pill ${r.status}">${STL[r.status]}</span><span class="amt num">${won(sub)}</span></div>
        ${G[rid].slice().reverse().map(cardHTML).join('')}
        <div class="bg-f"><span>${r.name} 환급 예상 (${rf.ru.label}${rf.why ? ' · ' + rf.why : ''})</span><b class="num">− ${won(rf.v)}</b></div></div>`;
    }).join('') : `<div class="stack-empty">담은 장소가 가는 지역별 바구니로 쌓이고<br>예상 경비가 자동으로 계산돼요.</div>`;
    const items = S.cart.filter((c) => show.includes(PM[c.pid].region_id));
    const byCat = { food: 0, stay: 0, cafe: 0, spot: 0 }, byR = {}; let total = 0;
    items.forEach((c) => { const p = PM[c.pid], a = lineCost(c).amt; byCat[p.category] += a; byR[p.region_id] = (byR[p.region_id] || 0) + a; total += a; });
    $('bar').innerHTML = total ? Object.entries(byCat).filter((e) => e[1]).map(([k, v]) => `<i style="width:${v / total * 100}%;background:${CAT[k].c}"></i>`).join('') : '';
    $('barl').innerHTML = Object.entries(byCat).map(([k, v]) => `<span><span class="dot" style="background:${CAT[k].c}"></span>${CAT[k].n} <b class="num">${won(v)}</b></span>`).join('');
    let refund = 0, rg = '';
    Object.entries(byR).forEach(([rid, a]) => { const f = refundOf(rid, a); refund += f.v; rg += `${RM[rid].name} ${won(a)} → 환급 ${won(f.v)}${f.why ? ` (${f.why})` : ''}${RM[rid].status === 'closed' ? ' (현재 마감)' : ''}<br>`; });
    const only = Object.keys(byR).length === 1 ? refundOf(...Object.entries(byR)[0]) : null;
    const sumLabel = only ? only.ru.label + (only.why ? ' · ' + only.why : '') : MODE[S.mode];
    const n = nights(), scope = S.basket === 'all' ? '전체 바구니' : (RM[S.basket] ? RM[S.basket].name + ' 바구니' : '');
    $('sum').innerHTML = `<div class="row"><span>${scope ? scope + ' · ' : ''}여행 기간</span><b class="num">${n}박 ${n + 1}일 · ${S.people}명</b></div>
      <div class="row"><span>예상 경비 합계</span><b class="num">${won(total)}</b></div>
      <div class="row refund"><span>반값여행 환급 예상 (${sumLabel})</span><b class="num">− ${won(refund)}</b></div>
      ${rg && Object.keys(byR).length > 1 ? `<div class="rg num">${rg}</div>` : ''}
      <div class="row total"><span>실제 부담 예상</span><b class="num">${won(total - refund)}</b></div>
      <p class="fine">반값여행은 지역마다 따로 신청·정산하므로 바구니도 지역별로 나눠 계산합니다. 환급은 지역화폐 가맹점 결제만 인정되고 지역사랑상품권으로 지급되며, 비율·한도·최소 소비 금액은 해당 지자체 공고가 최종 기준입니다.</p>`;
  }

  /* ───────── AI 코스 ① 최단 동선 (거리 계산은 알고리즘, 설명·시간 배치는 LLM 예정) ───────── */
  const km = (a, b) => { const R0 = 6371, t = Math.PI / 180, dLa = (b.lat - a.lat) * t, dLo = (b.lng - a.lng) * t;
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLo / 2) ** 2; return 2 * R0 * Math.asin(Math.sqrt(h)); };
  // 숙소(없으면 첫 장소)에서 출발 → 가장 가까운 곳부터(최근접) → 2-opt 로 꼬인 구간 풀기
  function shortestOrder(ids) {
    if (ids.length < 3) return ids.slice();
    const P = ids.map((id) => PM[id]);
    const s0 = Math.max(0, P.findIndex((p) => p.category === 'stay'));
    let order = [s0], left = new Set(P.map((_, i) => i)); left.delete(s0);
    while (left.size) { const last = P[order[order.length - 1]]; let best = null, bd = 1e9;
      left.forEach((i) => { const d = km(last, P[i]); if (d < bd) { bd = d; best = i; } }); order.push(best); left.delete(best); }
    const len = (o) => o.slice(1).reduce((s, i, k) => s + km(P[o[k]], P[i]), 0);
    for (let improved = true, guard = 0; improved && guard < 50; guard++) { improved = false;
      for (let i = 1; i < order.length - 1; i++) for (let j = i + 1; j < order.length; j++) {
        const o2 = order.slice(0, i).concat(order.slice(i, j + 1).reverse(), order.slice(j + 1));
        if (len(o2) + 1e-9 < len(order)) { order = o2; improved = true; } } }
    return order.map((i) => ids[i]);
  }
  // 동선은 한 지역 바구니 안에서만 (전체 보기일 땐 가장 많이 담은 지역)
  function basketIds() {
    const G = groups(); let rid = S.basket;
    if (rid === 'all' || !G[rid]) rid = Object.keys(G).sort((a, b) => G[b].length - G[a].length)[0];
    return rid ? G[rid].map((c) => c.pid) : [];
  }
  function renderRoute() {
    const box = $('route'), ids = basketIds();
    if (ids.length < 2) { box.innerHTML = `<div class="route-h"><b>AI 코스 · 최단 동선 <small>장소 2곳 이상 담으면 계산</small></b></div>`; return; }
    const order = S.route || shortestOrder(ids);
    let tot = 0;
    const li = order.map((id, i) => { const p = PM[id]; const d = i ? km(PM[order[i - 1]], p) : 0; tot += d;
      return `<li><span class="k">${i + 1}</span><span class="nm2">${esc(p.name)}</span><span class="leg num">${i ? '+' + d.toFixed(1) + 'km' : '출발'}</span></li>`; }).join('');
    box.innerHTML = `<div class="route-h"><b>AI 코스 · ${RM[PM[order[0]].region_id].name} 최단 동선 <small>직선거리 ${tot.toFixed(1)}km</small></b>
      <button type="button" class="btn2${S.route ? ' on' : ''}" data-route>${S.route ? '동선 끄기' : '지도에서 보기'}</button></div>
      <ol class="rsteps">${li}</ol>
      <p class="rnote">순서는 거리 계산으로 정하고(숙소 출발·최근접 + 2-opt), 실제 도로 시간·운영시간 반영과 일정 설명은 AI가 맡을 예정입니다.</p>`;
  }
  function drawRoute() {
    const g = $('g-route');
    if (!S.route) { g.innerHTML = ''; return; }
    g.innerHTML = `<polyline class="route-line" points="${S.route.map((id) => PM[id].x + ',' + PM[id].y).join(' ')}"/>`;
  }
  function toggleRoute() {
    if (S.route) { S.route = null; drawRoute(); renderRoute(); renderOverlay(); return; }
    const ids = basketIds(); if (ids.length < 2) return;
    S.route = shortestOrder(ids); drawRoute(); renderRoute();
    const ps = S.route.map((id) => PM[id]), xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
    const rids = new Set(ps.map((p) => p.region_id));
    openTrip(false);
    if (rids.size === 1) { S.view = 'region'; S.rid = ps[0].region_id; S.cat = 'all'; S.pid = null; renderAll(); }
    else { S.view = 'region'; S.rid = ps[0].region_id; renderAll(); }
    animateVB(fitBox([Math.min(...xs) - 4, Math.min(...ys) - 4, Math.max(...xs) + 4, Math.max(...ys) + 4], 0.25), 700, placeOverlay);
  }

  /* ───────── 상태 전환 ───────── */
  function paintTargets() {
    if (S.view === 'all') [...R].sort((a, b) => ORDER[a.status] - ORDER[b.status]).forEach((r) => $('g-targets').appendChild(r.el));
    R.forEach((r) => {
      r.el.classList.toggle('sel', S.view === 'region' && r.id === S.rid);
      if (S.view === 'region' && r.id === S.rid) $('g-targets').appendChild(r.el); // 이웃이 경계선을 덮지 않게 맨 위로
      r.el.classList.toggle('dimmed', S.view === 'all' && S.filter !== 'all' && r.status !== S.filter);
    });
    deco.style.opacity = S.view === 'all' ? 1 : 0;
  }
  function renderAll() { document.body.classList.toggle('zoomed', S.view === 'region'); renderTop(); renderLeft(); renderTray(); renderStack(); renderRoute(); drawRoute(); paintTargets(); renderOverlay(); }
  function openRegion(id) {
    S.view = 'region'; S.rid = id; S.cat = 'all'; S.pid = null;
    if (mobile()) setSheet('peek');
    renderAll(); animateVB(fitBox(RM[id].bbox), 700, placeOverlay);
    $('left').scrollTop = 0;
  }
  function goHome() { S.view = 'all'; S.rid = null; S.pid = null; renderAll(); animateVB(VB0.slice(), 650, () => { layoutPins(); placeOverlay(); }); }
  function toggleCart(pid) {
    const i = S.cart.findIndex((c) => c.pid === pid);
    if (i >= 0) S.cart.splice(i, 1);
    else { S.cart.push({ pid, qty: defaultQty(PM[pid]) }); S.basket = PM[pid].region_id; toast(`${RM[PM[pid].region_id].name} 바구니에 담았어요`); }
    S.route = null; drawRoute(); renderTray(); renderStack(); renderRoute(); renderOverlay();
  }

  /* ───────── 휴대폰 시트·탭 ───────── */
  const sheet = $('sheet');
  function setSheet(state) {
    document.body.dataset.sheet = state;
    const H = $('mapwrap').parentElement.clientHeight;
    sheet.style.setProperty('--sheet-h', state === 'peek' ? '' : state === 'half' ? Math.round(H * 0.56) + 'px' : Math.round(H * 0.94) + 'px');
  }
  let drag = null;
  $('handle').addEventListener('pointerdown', (e) => { drag = { y: e.clientY, h: sheet.offsetHeight, moved: false }; sheet.classList.add('dragging'); $('handle').setPointerCapture(e.pointerId); });
  $('handle').addEventListener('pointermove', (e) => { if (!drag) return; const dy = drag.y - e.clientY; if (Math.abs(dy) > 4) drag.moved = true; sheet.style.setProperty('--sheet-h', Math.max(120, drag.h + dy) + 'px'); });
  $('handle').addEventListener('pointerup', () => {
    if (!drag) return; sheet.classList.remove('dragging');
    const H = sheet.parentElement.clientHeight, h = sheet.offsetHeight;
    if (!drag.moved) setSheet({ peek: 'half', half: 'full', full: 'peek' }[document.body.dataset.sheet]);
    else setSheet(h < H * 0.38 ? 'peek' : h < H * 0.78 ? 'half' : 'full');
    drag = null;
  });
  function openTrip(on) {
    document.body.classList.toggle('trip-open', on);
    document.querySelectorAll('.tabbar [data-tab]').forEach((b) => b.setAttribute('aria-current', (b.dataset.tab === 'map') !== on ? 'page' : 'false'));
  }
  let toastT;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1600); }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    const d = t.dataset;
    if (d.r && !t.closest('svg')) return openRegion(d.r);
    if (t.hasAttribute('data-home')) return goHome();
    if (d.f) { S.filter = d.f; renderLeft(); paintTargets(); renderOverlay(); return; }
    if (d.cat) { S.cat = d.cat; S.pid = null; renderTop(); renderLeft(); renderOverlay(); return; }
    if (d.p) { S.pid = d.p; if (mobile()) setSheet('peek'); renderLeft(); renderOverlay(); return; }
    if (t.hasAttribute('data-close')) { S.pid = null; renderLeft(); renderOverlay(); return; }
    if (d.add) return toggleCart(d.add);
    if (d.rm) return toggleCart(d.rm);
    if (d.q) { const c = S.cart.find((c) => c.pid === d.q); c.qty = Math.max(1, c.qty + +d.d); renderStack(); return; }
    if (d.m) { S.mode = d.m; document.querySelectorAll('#mode button').forEach((b) => b.setAttribute('aria-pressed', b === t)); renderStack(); return; }
    if (t.id === 'pm' || t.id === 'pl') return setPeople(S.people + (t.id === 'pl' ? 1 : -1));
    if (d.basket) { S.basket = d.basket; S.route = null; drawRoute(); renderTray(); renderStack(); renderRoute(); renderOverlay(); return; }
    if (t.hasAttribute('data-route')) return toggleRoute();
    if (t.id === 'replay') return playIntro();
    if (d.tab === 'ai') { openTrip(true); $('route').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (d.tab) return openTrip(d.tab === 'trip');
    if (t.id === 'tripClose') return openTrip(false);
    if (d.soon) return toast(`${d.soon}은 다음 단계에서 열려요`);
  });
  ['d1', 'd2'].forEach((id) => $(id).addEventListener('change', () => { renderStack(); renderRoute(); }));
  new ResizeObserver(() => { if (S.view === 'all') { vb = VB0.slice(); svg.setAttribute('viewBox', vb.join(' ')); layoutPins(); } else setVB(fitBox(RM[S.rid].bbox)); placeOverlay(); }).observe(wrap);

  /* ───────── 인트로: ㄹ·ㅋ가 양쪽에서 날아와 붙고 → 한반도 윤곽으로 변형 ───────── */
  const morph = $('morph');
  const layers = [$('g-prov'), $('g-munis'), $('g-targets'), $('g-deco')];
  function glyphs() {
    // 본토 외곽선의 경계 상자에 ㄹ(서쪽)·ㅋ(동쪽)을 맞춘다
    const tmp = el('path', { d: GEO.mainland }); svg.appendChild(tmp); const b = tmp.getBBox(); tmp.remove();
    const mapPt = (x, y) => [b.x + (x - 48) / 354 * b.width, b.y + (y - 28) / 474 * b.height];
    const poly = (pts) => 'M' + pts.map(([x, y]) => mapPt(x, y).map((v) => v.toFixed(1)).join(' ')).join('L') + 'Z';
    return [
      poly([[48, 38], [212, 38], [212, 272], [92, 272], [92, 458], [232, 458], [232, 502], [48, 502], [48, 228], [168, 228], [168, 82], [48, 82]]),
      poly([[208, 28], [402, 28], [402, 482], [358, 482], [358, 262], [228, 262], [228, 218], [358, 218], [358, 72], [208, 72]]),
    ];
  }
  let introRaf = null;
  function playIntro() {
    if (S.view !== 'all') { S.view = 'all'; S.rid = null; S.pid = null; vb = VB0.slice(); svg.setAttribute('viewBox', vb.join(' ')); renderAll(); }
    cancelAnimationFrame(introRaf);
    wrap.classList.remove('intro'); void wrap.offsetWidth; wrap.classList.add('intro');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !window.flubber) { morph.setAttribute('d', ''); layers.forEach((l) => (l.style.opacity = 1)); wrap.classList.remove('intro'); return; }
    const [gR, gK] = glyphs();
    const interp = flubber.combine([gR, gK], GEO.mainland, { single: true, maxSegmentLength: 5 });
    const ACC = [47, 93, 80], LAND = [225, 231, 228];
    const mix = (k) => 'rgb(' + ACC.map((v, i) => Math.round(v + (LAND[i] - v) * k)).join(',') + ')';
    const ease = (k) => 1 - Math.pow(1 - k, 3), easeIO = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
    layers.forEach((l) => { l.style.transition = 'none'; l.style.opacity = 0; });
    const t0 = performance.now(), W = VB0[2];
    const step = (t) => {
      const e = (t - t0) / 1000;
      if (e < 0.95) { // 1) 양쪽에서 날아와 붙기
        const k = ease(Math.min(1, e / 0.85)), off = (1 - k) * W * 0.45;
        const r0 = interp(0); // 시작 모양(글자 둘)
        morph.setAttribute('d', r0); morph.style.fill = mix(0); morph.style.opacity = Math.min(1, e / 0.3);
        morph.setAttribute('transform', '');
        const parts = r0.split('M').filter(Boolean);
        const half = Math.ceil(parts.length / 2);
        // 글자별로 반대 방향에서 들어오도록 두 조각을 따로 이동
        morph.setAttribute('d', parts.map((p, i) => 'M' + p.replace(/(-?\d+\.?\d*)[ ,](-?\d+\.?\d*)/g, (m, x, y) => `${(+x + (i < half ? -off : off)).toFixed(1)} ${y}`)).join(''));
      } else if (e < 2.25) { // 2) 한반도 모양으로 변형
        const k = easeIO(Math.min(1, (e - 1.05) / 1.1)), kk = Math.max(0, k);
        morph.setAttribute('d', interp(kk)); morph.style.fill = mix(kk); morph.style.opacity = 1;
      } else { // 3) 실제 경계 지도로 교체
        layers.forEach((l) => { l.style.transition = ''; l.style.opacity = 1; });
        morph.style.transition = 'opacity .5s'; morph.style.opacity = 0;
        setTimeout(() => { morph.setAttribute('d', ''); morph.style.transition = ''; }, 520);
        setTimeout(() => wrap.classList.remove('intro'), 1400); // 핀 등장 애니메이션 끝나면 해제(다시 그릴 때 깜빡임 방지)
        return;
      }
      introRaf = requestAnimationFrame(step);
    };
    introRaf = requestAnimationFrame(step);
  }

  // 첫 화면: 예시 장바구니를 담아 계산 기능이 보이게
  const pick = (rid, cat, i = 0) => (placesOf(rid).filter((p) => p.category === cat)[i] || {}).id;
  const cartOf = (ids) => ids.filter(Boolean).map((pid) => ({ pid, qty: defaultQty(PM[pid]) }));
  S.cart = cartOf([pick('geochang', 'food'), pick('geochang', 'stay'), pick('geochang', 'cafe'), pick('hamyang', 'food')]); S.basket = 'geochang';
  setVB(VB0.slice()); renderAll(); playIntro();

  // 홈 화면 설치(PWA) — 지원되는 곳에서만
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

  // 화면 캡처·발표용 상태 전환
  window.__demo = (k) => {
    if (k === 'home') { S.cart = []; goHome(); }
    if (k === 'region') openRegion('geochang');
    if (k === 'pop') { openRegion('geochang'); setTimeout(() => { S.pid = pick('geochang', 'food'); renderLeft(); renderOverlay(); }, 760); }
    if (k === 'trip') openTrip(true);
    if (k === 'sheet') setSheet('half');
    if (k === 'route') { S.cart = cartOf([pick('geochang', 'stay'), pick('geochang', 'food'), pick('geochang', 'cafe'), pick('geochang', 'spot', 1), pick('geochang', 'food', 1)]); renderAll(); toggleRoute(); }
  };
})();
