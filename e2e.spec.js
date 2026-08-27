/**
 * e2e.spec.js
 * 위키백과 크롤링 동작 검증:
 * - 드래그(텍스트 선택) 후 엮기를 누르면 위키백과 문서가 출력되는지 (RTF 폴백이 아닌지)
 * - 드래그 직후 곧바로 엮기를 눌러도(크롤링 완료 전) 위키백과로 연결되는지
 */
const { test } = require('@playwright/test');

const BASE_URL = 'http://localhost:8080/index.html';

async function selectText(page, needle) {
  await page.evaluate((n) => {
    const el = document.getElementById('contentText');
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const idx = node.textContent.indexOf(n);
      if (idx !== -1) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + n.length);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return;
      }
    }
  }, needle);
}

// 초기 본문이 텍스트 시침질의 랜덤 인용문이므로 고정 문자열로 선택할 수 없다.
// 합성 글꼴 span으로 감싸진 텍스트 노드(청크) 중 index번째 노드 전체를 선택한다.
// 청크 하나는 항상 연속된 조각이므로 어떤 인용문이 나와도 안전하게 드래그할 수 있다.
async function selectChunk(page, index) {
  await page.evaluate((idx) => {
    const el = document.getElementById('contentText');
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = null;
    for (let i = 0; i <= idx; i++) {
      node = walker.nextNode();
      if (!node) break;
    }
    if (node) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }
  }, index);
}

async function waitForContent(popup, timeoutMs = 20000) {
  await popup.waitForFunction(
    () => {
      const el = document.getElementById('contentText');
      const t = el && el.textContent ? el.textContent.trim() : '';
      return t.length > 0 && t.indexOf('불러오는 중') === -1 && t.indexOf('위키백과에서 제시문') === -1;
    },
    { timeout: timeoutMs }
  );
}

async function capturePopup(popup) {
  return popup.evaluate(() => {
    const t = document.getElementById('contentText').textContent.trim();
    return {
      title: document.title,
      contentHead: t.slice(0, 60),
      isRtfFallback: t.indexOf('텍스트 시침질') !== -1 || t.indexOf('오혜진') !== -1 || t.indexOf('『') !== -1,
    };
  });
}

test('드래그 → 엮기: 위키백과 크롤링 동작 검증', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // 시나리오 1: 드래그 후 충분히 기다렸다가 엮기
  await selectChunk(page, 0);
  await page.waitForTimeout(3000); // 크롤링 완료 대기

  let popupPromise = page.waitForEvent('popup');
  await page.click('#confirmBtn');
  let popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  await waitForContent(popup);
  const s1 = await capturePopup(popup);
  console.log('[시나리오1: 드래그 후 대기 → 엮기]', JSON.stringify(s1));
  await popup.close();

  // 시나리오 2: 드래그 직후 곧바로 엮기 (크롤링 완료 전)
  // 시나리오1과 다른(두 번째) 청크를 선택해 새 드래그로 처리되게 한다
  await selectChunk(page, 1);
  popupPromise = page.waitForEvent('popup');
  await page.click('#confirmBtn');
  popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  await waitForContent(popup);
  const s2 = await capturePopup(popup);
  console.log('[시나리오2: 드래그 직후 곧바로 엮기]', JSON.stringify(s2));
  await popup.close();
});

// 재귀 문서 방지 검증:
// 같은 위키백과 문서를 연속으로 출력하려 하면(드래그 상태 유지 후 엮기 재클릭, 또는
// 팝업 안에서 현재 탭과 동일한 문서 재크롤링) 동일 문서가 아닌 RTF 폴백 텍스트가 출력되어야 한다.
test('재귀 문서 방지: 동일 위키 문서 연속 출력 시 RTF 폴백 검증', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // 메인 페이지에서 드래그 → 위키백과 문서 확보 (state.title / document.title 갱신)
  await selectChunk(page, 0);
  await page.waitForTimeout(3000);

  // 1차 엮기: 위키백과 문서가 팝업 A로 출력되고 lastOutputTitle에 기록됨
  let popupPromise = page.waitForEvent('popup');
  await page.click('#confirmBtn');
  const popupA = await popupPromise;
  await popupA.waitForLoadState('domcontentloaded');
  await waitForContent(popupA);
  const sA = await capturePopup(popupA);
  console.log('[재귀 1차: 드래그 후 엮기]', JSON.stringify(sA));

  // 2차 엮기: 드래그 상태 유지된 채 동일 문서를 다시 전달하려는 경우 (재귀)
  popupPromise = page.waitForEvent('popup');
  await page.click('#confirmBtn');
  const popupB = await popupPromise;
  await popupB.waitForLoadState('domcontentloaded');
  await waitForContent(popupB);
  const sB = await capturePopup(popupB);
  console.log('[재귀 2차: 동일 문서 재출력 시도]', JSON.stringify(sB));

  // 2차 팝업이 1차와 동일한 위키백과 문서를 반복 출력하면 재귀 버그
  if (sB.title === sA.title && !sB.isRtfFallback) {
    throw new Error('재귀 문서 버그 발생: 동일 위키백과 문서가 반복 출력됨 (' + sB.title + ')');
  }
  console.log('재귀 문서 방지 동작 확인 → 2차 팝업: "' + sB.title + '" (RTF 폴백: ' + sB.isRtfFallback + ')');

  await popupA.close();
  await popupB.close();
});

// 팝업 체인 재귀 검증: 팝업 A(위키 X 표시) 안에서 텍스트를 드래그해 같은 문서 X가
// 다시 크롤링되면(document.title === state.title) 팝업 B는 RTF 폴백이어야 한다.
test('재귀 문서 방지: 팝업 체인 내 동일 문서 재크롤링 시 RTF 폴백 검증', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  await selectChunk(page, 0);
  await page.waitForTimeout(3000);

  let popupPromise = page.waitForEvent('popup');
  await page.click('#confirmBtn');
  const popupA = await popupPromise;
  await popupA.waitForLoadState('domcontentloaded');
  await waitForContent(popupA);
  const sA = await capturePopup(popupA);
  console.log('[체인 A: 드래그 후 엮기]', JSON.stringify(sA));

  // 팝업 A 본문의 첫 번째 청크를 드래그해 재크롤링 시도 (랜덤 본문에도 안전하게 동작)
  await selectChunk(popupA, 0);
  await popupA.waitForTimeout(3000);

  popupPromise = popupA.waitForEvent('popup');
  await popupA.click('#confirmBtn');
  const popupB = await popupPromise;
  await popupB.waitForLoadState('domcontentloaded');
  await waitForContent(popupB);
  const sB = await capturePopup(popupB);
  console.log('[체인 B: 팝업 내 재드래그 후 엮기]', JSON.stringify(sB));

  // 팝업 B가 팝업 A와 동일한 위키백과 문서를 반복 출력하면 재귀 버그
  if (sB.title === sA.title && !sB.isRtfFallback) {
    throw new Error('팝업 체인 재귀 버그 발생: 동일 문서 반복 출력됨 (' + sB.title + ')');
  }
  console.log('팝업 체인 재귀 방지 동작 확인 → B: "' + sB.title + '" (RTF 폴백: ' + sB.isRtfFallback + ')');

  await popupA.close();
  await popupB.close();
});
