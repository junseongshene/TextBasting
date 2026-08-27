/**
 * artboard.js
 * 아트보드 상태 관리, DOM 랜더링 및 새 창 파생 전송 모듈
 */

const ArtboardManager = (() => {
  // 텍스트 시침질.rtf 인용문 중 하나를 무작위로 골라 초기 본문으로 사용한다.
  // - 창을 처음 열었을 때 고정된 에콜로지 텍스트 대신 시침질의 랜덤한 본문이 나오도록 한다.
  // - rtf_citations.js의 RTF_CITATIONS(54개) 중 랜덤으로 하나를 고른다.
  function pickRandomCitation() {
    const list = (typeof RTF_CITATIONS !== 'undefined' && RTF_CITATIONS.length) ? RTF_CITATIONS : [];
    if (list.length === 0) return null;
    return list[Math.floor(Math.random() * list.length)];
  }

  const initialCitation = pickRandomCitation();

  // 현재 아트보드의 데이터 상태 (최초 출력: 텍스트 시침질 랜덤 본문)
  let state = initialCitation
    ? {
        title: initialCitation.title,
        fullContent: initialCitation.body,
        source: '텍스트 시침질.rtf'
      }
    : {
        title: '에콜로지 Ecology',
        fullContent: '에콜로지란 사람들이 함께 잘살아갈 수 있는 물리적, 사회적 서식지(habitats)에 관한 학문으로, 그러한 삶을 조성하거나 좌절시키는 것을 인식하는(knowing) 방식, 그것을 통해 이 다층적으로 실현이 가능한 목적을 달성하게 하거나 혹은 이루지 못하게 가로막는 지식, 행위, 관습, 사회적 구조, 창조적이고 규범적 원칙들을 수립하는 에토스(ethos)와 아비투스(habitus)에 관한 학문이다.',
        source: '로레인 코드, 『에콜로지적 사고 Ecological Thinking』, p. 25.'
      };

  // 드래그(크롤링)가 발생했는지 여부 - 없이 엮기를 누르면 RTF 폴백 텍스트를 사용
  let hasDragged = false;

  // 가장 최근에 드래그한 텍스트 - 크롤링이 끝나기 전에 엮기를 누르면 팝업에서 이 텍스트로 크롤링
  let lastDraggedText = '';

  // 위키백과 재귀 문서 방지용 마지막 출력 문서 제목 - 동일 문서가 연속 출력되지 않도록 추적
  let lastOutputTitle = null;

  // DOM 요소 참조
  let elements = {};

  function initElements() {
    elements = {
      contentText: document.getElementById('contentText'),
      confirmBtn: document.getElementById('confirmBtn')
    };
  }

  // 전체 DOM 합성 글꼴 포맷 렌더링
  function renderAll() {
    if (elements.contentText) CompositeFontFormatter.applyToElement(elements.contentText, state.fullContent);
    // 확정 버튼도 본문과 동일한 합성 글꼴 포맷 적용
    if (elements.confirmBtn) CompositeFontFormatter.applyToElement(elements.confirmBtn);
  }

  // 최초 배치 시에만 사용할 무작위 위치 비율/기울기 (리사이즈 시 재랜덤화 방지)
  let contentPosX = null;
  let contentPosY = null;
  let contentRotate = null; // 좌우 ±30도 내 랜덤 기울기

  // 이전 팝업에서 전달받은 텍스트박스 사각형(뷰포트 비율) - 피해서 배치할 영역
  let prevBoxRect = null;

  // 현재 본문 텍스트 박스의 위치/크기를 부모(뷰포트) 기준 비율로 반환
  function getContentBoxRectFractions() {
    const el = elements.contentText;
    const parent = el && el.parentElement;
    if (!el || !parent) return null;
    const parentW = parent.clientWidth || 1;
    const parentH = parent.clientHeight || 1;
    return {
      left: el.offsetLeft / parentW,
      top: el.offsetTop / parentH,
      right: (el.offsetLeft + el.offsetWidth) / parentW,
      bottom: (el.offsetTop + el.offsetHeight) / parentH
    };
  }

  // 회색 내지(안전 영역) 계산
  // .a4-artboard의 패딩(마진) 안쪽 본문 영역만 텍스트박스 배치에 사용한다.
  // 이렇게 하면 텍스트박스(회전 포함)가 마진/흰 테두리를 침범하지 않는다.
  function getSafeArea(parent) {
    const style = getComputedStyle(parent);
    const padL = parseFloat(style.paddingLeft) || 0;
    const padT = parseFloat(style.paddingTop) || 0;
    const padR = parseFloat(style.paddingRight) || 0;
    const padB = parseFloat(style.paddingBottom) || 0;
    const w = Math.max(parent.clientWidth - padL - padR, 0);
    const h = Math.max(parent.clientHeight - padT - padB, 0);
    return { left: padL, top: padT, right: padL + w, bottom: padT + h };
  }

  // 주어진 회전 각도에서 텍스트박스(W×H)가 안전 영역 안에 들어오도록 하는
  // left/top의 허용 범위(px)와 회전 외곽 크기(bbW/bbH)를 계산한다.
  // 회전 중심은 박스 중앙이므로 회전 후 외곽 사각형의 중심도 같은 위치다.
  function computeSafeRange(boxW, boxH, safe, deg) {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const bbW = boxW * cos + boxH * sin;
    const bbH = boxW * sin + boxH * cos;
    return {
      leftMin: safe.left + (bbW - boxW) / 2,
      leftMax: safe.right - (bbW + boxW) / 2,
      topMin: safe.top + (bbH - boxH) / 2,
      topMax: safe.bottom - (bbH + boxH) / 2,
      bbW,
      bbH
    };
  }

  // 주어진 각도에서 안전 영역 안에 배치 가능한지(좌표 범위가 유효한지) 판정
  function rotationFits(boxW, boxH, safe, deg) {
    const r = computeSafeRange(boxW, boxH, safe, deg);
    return r.leftMin <= r.leftMax && r.topMin <= r.topMax;
  }

  // 텍스트박스가 회색 영역을 벗어나지 않는 최대 회전 각도(도)를 찾는다.
  // 기존 디자인의 최대 ±30도를 상한으로, 안전 영역이 작으면 각도를 줄인다.
  function findMaxSafeRotation(boxW, boxH, safe) {
    const MAX_DEG = 30;
    if (!rotationFits(boxW, boxH, safe, 0)) return 0;
    if (rotationFits(boxW, boxH, safe, MAX_DEG)) return MAX_DEG;
    let lo = 0;
    let hi = MAX_DEG;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (rotationFits(boxW, boxH, safe, mid)) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  // 이전 팝업 텍스트박스를 피해 안전 범위(px) 내 무작위 위치(비율)를 탐색
  // - range: 텍스트박스(회전 포함)가 허용되는 left/top 범위
  // - bbW/bbH: 회전된 박스의 외곽 사각형 크기(px) - 겹침 판정에 사용
  function pickAvoidingFraction(parent, range, bbW, bbH) {
    const w = Math.max(range.leftMax - range.leftMin, 0);
    const h = Math.max(range.topMax - range.topMin, 0);
    const parentW = parent.clientWidth || 1;
    const parentH = parent.clientHeight || 1;
    const boxWFrac = parentW > 0 ? bbW / parentW : 0;
    const boxHFrac = parentH > 0 ? bbH / parentH : 0;

    // 최대 30회 무작위 시도: 이전 박스와 겹치지 않는 위치를 찾으면 반환
    for (let i = 0; i < 30; i++) {
      const x = Math.random();
      const y = Math.random();
      if (!prevBoxRect) return { x, y };

      const leftFrac = (range.leftMin + x * w) / parentW;
      const topFrac = (range.topMin + y * h) / parentH;
      const newRight = leftFrac + boxWFrac;
      const newBottom = topFrac + boxHFrac;
      const overlaps = !(newRight <= prevBoxRect.left || leftFrac >= prevBoxRect.right ||
                         newBottom <= prevBoxRect.top || topFrac >= prevBoxRect.bottom);
      if (!overlaps) return { x, y };
    }

    // 못 찾으면 이전 박스 중심에서 가장 먼 모서리 쪽 여백에 배치
    const centerXF = (prevBoxRect.left + prevBoxRect.right) / 2;
    const centerYF = (prevBoxRect.top + prevBoxRect.bottom) / 2;
    const corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }];
    let best = corners[0];
    let bestDist = -1;
    for (const c of corners) {
      const d = (c.x - centerXF) ** 2 + (c.y - centerYF) ** 2;
      if (d > bestDist) { bestDist = d; best = c; }
    }
    return { x: best.x, y: best.y };
  }

  // 본문 텍스트 박스의 무작위 위치/기울기 배치
  // - 모든 페이지에서 텍스트박스(회전 포함)가 회색 영역(마진 안쪽)을 벗어나지 않는다.
  // - 크기는 CSS vw/vh로 항상 1/16 면적을 보장한다.
  function layoutContentRandomly() {
    const el = elements.contentText;
    const parent = el && el.parentElement;
    if (!el || !parent) return;

    const boxW = el.offsetWidth;
    const boxH = el.offsetHeight;
    const safe = getSafeArea(parent);

    // 최초 1회만 무작위 위치 비율과 기울기를 정하고, 이후(창 크기 변경)에는 유지
    if (contentPosX === null || contentPosY === null || contentRotate === null) {
      // 안전 영역에 맞는 최대 회전 각도 안에서 무작위 기울기 선택
      const maxAngle = findMaxSafeRotation(boxW, boxH, safe);
      let rot = (Math.random() * 2 - 1) * maxAngle;
      let range = computeSafeRange(boxW, boxH, safe, rot);
      // 안전장치: 선택된 각도에서 범위가 유효하지 않으면 회전 없이 배치
      if (range.leftMin > range.leftMax || range.topMin > range.topMax) {
        rot = 0;
        range = computeSafeRange(boxW, boxH, safe, 0);
      }
      contentRotate = rot;
      // 이전 팝업 텍스트박스를 피해 안전 범위 내 무작위 위치 비율 선택
      const frac = pickAvoidingFraction(parent, range, range.bbW, range.bbH);
      contentPosX = frac.x;
      contentPosY = frac.y;
    } else {
      // 창 크기가 변해 기존 기울기가 안전 영역을 벗어나면 최대 허용 각도로 줄인다
      const maxAngle = findMaxSafeRotation(boxW, boxH, safe);
      if (Math.abs(contentRotate) > maxAngle) {
        contentRotate = Math.sign(contentRotate) * maxAngle;
      }
    }

    // 회색 영역(마진 안쪽)만 사용하도록 left/top 범위를 제한해 좌표 계산
    const range = computeSafeRange(boxW, boxH, safe, contentRotate);
    const left = range.leftMin + contentPosX * Math.max(range.leftMax - range.leftMin, 0);
    const top = range.topMin + contentPosY * Math.max(range.topMax - range.topMin, 0);
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    // 안전 범위 내 랜덤 기울기 적용
    el.style.transform = `rotate(${contentRotate}deg)`;
  }

  // URL Query Parameter 상태 복원 및 DOM 업데이트
  async function loadStateFromUrl() {
    initElements();
    const urlParams = new URLSearchParams(window.location.search);
    const titleParam = urlParams.get('title');
    const contentParam = urlParams.get('content');
    const sourceParam = urlParams.get('source');
    const qParam = urlParams.get('q');

    // 이전 팝업에서 전달된 텍스트박스 사각형(뷰포트 비율) 읽기
    const prevLeft = parseFloat(urlParams.get('prevBoxLeft'));
    const prevTop = parseFloat(urlParams.get('prevBoxTop'));
    const prevRight = parseFloat(urlParams.get('prevBoxRight'));
    const prevBottom = parseFloat(urlParams.get('prevBoxBottom'));

    if (!isNaN(prevLeft) && !isNaN(prevTop) && !isNaN(prevRight) && !isNaN(prevBottom)) {
      prevBoxRect = { left: prevLeft, top: prevTop, right: prevRight, bottom: prevBottom };
    } else {
      prevBoxRect = null;
    }

    // 엮기로 열린 팝업(title 파라미터): 드래그한 내용과 연관된 위키백과 문서를 출력
    if (titleParam) {
      // 드래그 텍스트(q)로 크롤링: 크롤링 완료 전에 엮기를 눌러도 위키백과 문서를 출력
      if (qParam) {
        if (elements.contentText) elements.contentText.textContent = '위키백과에서 제시문을 불러오는 중...';
        const conceptResult = await WikiCrawler.crawl(qParam);
        state.title = conceptResult.title;
        state.fullContent = conceptResult.fullContent;
        state.source = conceptResult.source;
        document.title = conceptResult.title;
        renderAll();
        layoutContentRandomly();
        return;
      }

      // 드래그 없음 / 관련 검색어 없음(nodrag) → 텍스트 시침질.rtf 폴백 텍스트를 즉시 출력
      if (urlParams.get('nodrag') === '1') {
        state = { ...WikiCrawler.getFallbackText() };
        document.title = state.title;
        renderAll();
        layoutContentRandomly();
        return;
      }

      // 드래그한 문서 제목으로 위키백과 요약을 크롤링해 출력 (드래그와 연관된 내용)
      if (elements.contentText) elements.contentText.textContent = '위키백과에서 제시문을 불러오는 중...';
      const conceptResult = await WikiCrawler.crawlByTitle(titleParam);
      state.title = conceptResult.title;
      state.fullContent = conceptResult.fullContent;
      state.source = conceptResult.source;
      document.title = conceptResult.title;
      renderAll();
      // 실제 콘텐츠 기준으로 본문 텍스트 박스 위치/기울기 배치
      layoutContentRandomly();
      return;
    }

    if (titleParam && contentParam) {
      document.title = titleParam;
      state.title = titleParam;
      state.fullContent = contentParam;
      state.source = sourceParam || '';
    }

    // 메인 탭 최초 출력: 텍스트 시침질 랜덤 본문을 창 제목에도 반영
    document.title = state.title;
    renderAll();
    // 최초 로드 시 본문 텍스트 박스를 1/16 크기로 무작위 위치에 배치
    layoutContentRandomly();
  }

  // 드래그가 감지된 즉시 크롤링 경로로 표시 (비동기 크롤링이 끝나기 전에 엮기를 눌러도 동작)
  function markDragged() {
    hasDragged = true;
  }

  // 드래그 텍스트 기록 - 크롤링 완료 전 엮기 시 팝업이 이 텍스트로 직접 크롤링한다
  function setDraggedText(text) {
    hasDragged = true;
    if (text) lastDraggedText = text;
  }

  // 드래그 선택 결과를 전송 상태에만 반영 (원문 페이지는 확정 전까지 변경하지 않음)
  function updateDemoState(conceptResult) {
    hasDragged = true; // 드래그 크롤링 발생 기록
    state = {
      title: conceptResult.title,
      fullContent: conceptResult.fullContent,
      source: conceptResult.source
    };
  }

  // 로딩 상태 표시 (하단 데모 박스 제거로 현재 동작 없음)
  function showLoading(selectedText) {
    // 필요한 경우 본문 로딩 표시 처리 추가 가능
  }

  // 새 창이 이전 팝업 밖으로 방사(radiate)되도록 배치하는 위치/크기 계산
  // - 이전 창의 한쪽 엣지와 25~40% 겹치고, 바깥으로 돌출되어 이전 창 안에 갇히지 않는다.
  // - 방향(오른/왼/아래/위)과 겹침 비율·오프셋이 매번 랜덤이라 팝업들이 사방으로 퍼진다.
  // - 이전 창의 텍스트박스는 가리지 않는다.
  // - 반환: { left, top, winW, winH } (left/top: 바깥 창 화면 좌표, winW/winH: 내부(뷰포트) 크기)
  function computeMarginPlacement(defaultLandscapeW, defaultLandscapeH) {
    const availW = window.screen.availWidth;
    const availH = window.screen.availHeight;
    const prevLeft = window.screenX;
    const prevTop = window.screenY;
    const prevW = window.outerWidth;
    const prevH = window.outerHeight;
    const prevRight = prevLeft + prevW;
    const prevBottom = prevTop + prevH;
    const chromeW = window.outerWidth - window.innerWidth;
    const chromeH = window.outerHeight - window.innerHeight;

    // 이전 창의 텍스트박스 화면 사각형
    const boxEl = elements.contentText;
    let box = null;
    if (boxEl) {
      const r = boxEl.getBoundingClientRect();
      box = {
        left: window.screenX + r.left,
        top: window.screenY + r.top,
        right: window.screenX + r.right,
        bottom: window.screenY + r.bottom
      };
    }

    // 기본(최대) 크기: 가로/세로 랜덤
    const isLandscape = Math.random() >= 0.5;
    const baseW = isLandscape ? defaultLandscapeW : defaultLandscapeH;
    const baseH = isLandscape ? defaultLandscapeH : defaultLandscapeW;
    const outerW = baseW + chromeW;
    const outerH = baseH + chromeH;

    // 후보 창(바깥 크기 기준) 사각형이 이전 창의 텍스트박스와 겹치는지 판정
    const overlapsBox = (left, top) => {
      if (!box) return false;
      const right = left + outerW;
      const bottom = top + outerH;
      return !(right <= box.left || left >= box.right ||
               bottom <= box.top || top >= box.bottom);
    };

    // 방사 방향별 위치: 이전 창 엣지와 overlapFrac만큼 겹치고 바깥으로 돌출
    // - 돌출 축과 수직인 축은 '화면 안 유효 범위'로 먼저 클램프한 뒤 그 안에서 랜덤하게 뽑아
    //   필터에 걸려 좁아지지 않고 넓게 분포하도록 한다.
    const place = (dir, overlapFrac) => {
      let left, top;
      if (dir === 'right') {
        left = prevRight - overlapFrac * outerW; // 오른쪽 엣지에 겹치며 오른쪽으로 돌출
        const topMin = Math.max(0, prevTop - outerH);
        const topMax = Math.min(availH - outerH, prevBottom);
        top = topMin + Math.random() * Math.max(topMax - topMin, 0);
      } else if (dir === 'left') {
        left = prevLeft - outerW + overlapFrac * outerW; // 왼쪽 엣지에 겹치며 왼쪽으로 돌출
        const topMin = Math.max(0, prevTop - outerH);
        const topMax = Math.min(availH - outerH, prevBottom);
        top = topMin + Math.random() * Math.max(topMax - topMin, 0);
      } else if (dir === 'below') {
        top = prevBottom - overlapFrac * outerH; // 아래 엣지에 겹치며 아래로 돌출
        const leftMin = Math.max(0, prevLeft - outerW);
        const leftMax = Math.min(availW - outerW, prevRight);
        left = leftMin + Math.random() * Math.max(leftMax - leftMin, 0);
      } else { // above
        top = prevTop - outerH + overlapFrac * outerH; // 위 엣지에 겹치며 위로 돌출
        const leftMin = Math.max(0, prevLeft - outerW);
        const leftMax = Math.min(availW - outerW, prevRight);
        left = leftMin + Math.random() * Math.max(leftMax - leftMin, 0);
      }
      return { left, top };
    };

    const dirs = ['right', 'left', 'below', 'above'];

    // 최종 위치 보정: 화면 안으로 클램프하고, 이전 텍스트박스를 절대 가리지 않도록 한다.
    // - 겹치면 박스의 좌/우/상/하 중 화면 안에 들어가는 위치로 밀어내고,
    //   그래도 없으면 박스 중심에서 가장 먼 화면 모서리에 배치한다.
    const finalizePosition = (left, top) => {
      left = Math.max(0, Math.min(Math.round(left), availW - outerW));
      top = Math.max(0, Math.min(Math.round(top), availH - outerH));
      if (!overlapsBox(left, top)) {
        return { left, top, winW: baseW, winH: baseH };
      }

      const boxCandidates = [];
      const push = (l, t) => {
        const cl = Math.max(0, Math.min(Math.round(l), availW - outerW));
        const ct = Math.max(0, Math.min(Math.round(t), availH - outerH));
        if (!overlapsBox(cl, ct)) boxCandidates.push({ left: cl, top: ct });
      };
      if (box) {
        push(box.left - outerW, top);   // 박스 왼쪽
        push(box.right, top);           // 박스 오른쪽
        push(left, box.top - outerH);   // 박스 위
        push(left, box.bottom);         // 박스 아래
      }
      if (boxCandidates.length > 0) {
        const c = boxCandidates[Math.floor(Math.random() * boxCandidates.length)];
        return { left: c.left, top: c.top, winW: baseW, winH: baseH };
      }

      // 박스를 완전히 피할 자리가 없으면 박스 중심에서 가장 먼 화면 모서리
      const boxCenterX = box ? (box.left + box.right) / 2 : availW / 2;
      const boxCenterY = box ? (box.top + box.bottom) / 2 : availH / 2;
      const corners = [
        { left: 0, top: 0 },
        { left: Math.max(availW - outerW, 0), top: 0 },
        { left: 0, top: Math.max(availH - outerH, 0) },
        { left: Math.max(availW - outerW, 0), top: Math.max(availH - outerH, 0) }
      ];
      let best = corners[0];
      let bestDist = -1;
      for (const c of corners) {
        const cx = c.left + outerW / 2;
        const cy = c.top + outerH / 2;
        const d = (cx - boxCenterX) ** 2 + (cy - boxCenterY) ** 2;
        if (d > bestDist) { bestDist = d; best = c; }
      }
      return { left: best.left, top: best.top, winW: baseW, winH: baseH };
    };

    // 최대 40회 무작위 시도: 랜덤 방향 + 20~50% 겹침 + 랜덤 오프셋
    for (let i = 0; i < 40; i++) {
      const dir = dirs[Math.floor(Math.random() * dirs.length)];
      const overlap = 0.20 + Math.random() * 0.30;
      const p = place(dir, overlap);
      if (p.left < 0 || p.top < 0 || p.left + outerW > availW || p.top + outerH > availH) continue;
      if (overlapsBox(p.left, p.top)) continue;
      return finalizePosition(p.left, p.top);
    }

    // 무작위 시도가 실패하면(화면 가장자리/박스 등) 각 방향 기본 위치를 화면에 맞게 클램프
    const candidates = [];
    for (const dir of dirs) {
      const p = place(dir, 0.30);
      const left = Math.max(0, Math.min(Math.round(p.left), availW - outerW));
      const top = Math.max(0, Math.min(Math.round(p.top), availH - outerH));
      if (overlapsBox(left, top)) continue;
      candidates.push({ left, top });
    }
    if (candidates.length > 0) {
      const c = candidates[Math.floor(Math.random() * candidates.length)];
      return finalizePosition(c.left, c.top);
    }

    // 화면 내 랜덤 위치를 다시 시도하되, 반드시 이전 텍스트박스를 피한다.
    for (let i = 0; i < 60; i++) {
      const left = Math.round(Math.random() * Math.max(availW - outerW, 0));
      const top = Math.round(Math.random() * Math.max(availH - outerH, 0));
      if (!overlapsBox(left, top)) {
        return finalizePosition(left, top);
      }
    }

    // 최후: 박스에서 가장 먼 화면 모서리 (finalizePosition이 다시 보정)
    return finalizePosition(0, 0);
  }

  // 확정 버튼 클릭 시 URL Parameter 기반 새 창 파생
  // 창 이름을 매번 고유하게 부여해 클릭할 때마다 항상 새로운 창이 열리도록 한다 (무한 반복 가능)
  let conceptWindowSeq = 0;

  function openNewConceptWindow() {
    // window.open은 반드시 사용자 제스처(클릭) 안에서 동기적으로 호출해야
    // 위치/크기(left/top/width/height)가 브라우저에 정확히 반영된다.
    // 새 팝업의 다른 제시문 로드는 팝업이 로드된 뒤 스스로 수행한다(random=1).
    // 드래그 크롤링 결과가 실제 위키백과 문서인 경우 해당 문서 제목을 전달해
    // 팝업에서 그 문서를 크롤링해 출력한다. (드래그한 내용과 연관된 결과)
    const queryParams = new URLSearchParams({
      title: state.title
    });

    // 드래그 크롤링 결과가 위키백과 문서가 아니면(드래그 없음 / 관련 검색어 없음) RTF 폴백
    const isWikiResult = hasDragged && state.source && state.source.indexOf('위키백과') !== -1;

    // 위키백과 재귀 문서 방지: 현재 탭에 이미 표시된 문서(document.title)와 동일한 제목이거나,
    // 이 창에서 방금 전달한 제목(lastOutputTitle)과 같으면 같은 문서가 계속 반복 출력되지 않도록
    // RTF 폴백 텍스트로 돌린다.
    const isRecursive = isWikiResult && (
      state.title === document.title ||
      state.title === lastOutputTitle
    );

    if (!isWikiResult || isRecursive) {
      // 드래그는 했으나 크롤링이 아직 끝나지 않은 경우(위키 결과 미반영):
      // 드래그한 텍스트(q)를 전달해 팝업에서 직접 크롤링한다. (RTF 폴백으로 빠지는 것을 방지)
      if (!isWikiResult && lastDraggedText) {
        queryParams.set('q', lastDraggedText);
      } else {
        queryParams.set('nodrag', '1'); // 드래그 없음 또는 재귀 → 텍스트 시침질 RTF 폴백
      }
      lastOutputTitle = null; // RTF/텍스트 크롤링 출력 후에는 재귀 추적을 초기화
    } else {
      lastOutputTitle = state.title; // 전달한 위키백과 문서 제목을 기록해 다음 재귀를 감지
    }

    // 이전 팝업(현재 화면)의 텍스트박스 위치(비율)를 전달해 새 창 내부 배치에 반영
    const prevBox = getContentBoxRectFractions();
    if (prevBox) {
      queryParams.set('prevBoxLeft', prevBox.left.toFixed(4));
      queryParams.set('prevBoxTop', prevBox.top.toFixed(4));
      queryParams.set('prevBoxRight', prevBox.right.toFixed(4));
      queryParams.set('prevBoxBottom', prevBox.bottom.toFixed(4));
    }

    // 이전 팝업 텍스트박스의 화면 좌표를 전달해, 새 창이 그 박스를 덮지 않도록 자가 보정에 사용
    const pbEl = elements.contentText;
    if (pbEl) {
      const pb = pbEl.getBoundingClientRect();
      queryParams.set('pbL', String(Math.round(window.screenX + pb.left)));
      queryParams.set('pbT', String(Math.round(window.screenY + pb.top)));
      queryParams.set('pbR', String(Math.round(window.screenX + pb.right)));
      queryParams.set('pbB', String(Math.round(window.screenY + pb.bottom)));
    }

    // 이전 팝업의 텍스트박스 주변 여백 중 가장 넓은 곳에 새 창을 A4 비율로 맞춰 끼워 넣는다.
    // (여백 모양과 크기에 따라 가로/세로 방향과 크기가 유동적으로 결정됨)
    const POPUP_SCALE = 1.3;
    const LAND_W = Math.round(679 * POPUP_SCALE); // 883
    const LAND_H = Math.round(480 * POPUP_SCALE); // 624
    const placement = computeMarginPlacement(LAND_W, LAND_H);
    const winW = placement.winW;
    const winH = placement.winH;
    // 팝업 내부(뷰포트) 크기와 바깥 창 위치를 함께 전달해
    // window.open이 left/top을 무시해도 팝업이 로드 후 스스로 위치를 잡게 한다
    queryParams.set('iw', String(winW));
    queryParams.set('ih', String(winH));
    queryParams.set('pl', String(placement.left));
    queryParams.set('pt', String(placement.top));

    const targetUrl = `index.html?${queryParams.toString()}`;
    // window.open 세 번째 인자(속성)를 지정하면 브라우저가 새 탭이 아닌 새 창(popup)으로 열도록 강제한다.
    // 같은 이름의 창이 있으면 해당 창을 재사용하므로, 이름을 유일하게 만들어 항상 새 창을 연다.
    conceptWindowSeq += 1;
    const newWin = window.open(
      targetUrl,
      `conceptWindow_${Date.now()}_${conceptWindowSeq}`,
      `width=${winW},height=${winH},left=${placement.left},top=${placement.top},resizable=yes,scrollbars=yes`
    );

    if (!newWin) {
      alert('팝업 차단이 설정되어 있어 새 창을 열 수 없습니다. 브라우저 팝업 차단을 해제해 주세요.');
    }
  }

  return {
    loadStateFromUrl,
    updateDemoState,
    markDragged,
    setDraggedText,
    showLoading,
    openNewConceptWindow,
    layoutContentRandomly
  };
})();
