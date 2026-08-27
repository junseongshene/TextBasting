/**
 * app.js
 * 메인 애플리케이션 진입점 및 이벤트 바인딩 모듈
 */

document.addEventListener('DOMContentLoaded', () => {
  // 0. 창 크기 보정: 내부(뷰포트) 영역을 정확히 A4 가로(297:210) 비율로 맞춘다.
  //    window.resizeTo는 바깥(window) 크기이므로, 브라우저 크롬(제목줄/스크롤바)을 측정해 보정한다.
  try {
    const chromeW = window.outerWidth - window.innerWidth;
    const chromeH = window.outerHeight - window.innerHeight;

    if (window.location.search) {
      // 팝업: URL 파라미터(iw/ih)로 전달된 내부 크기와 위치(pl/pt)를 적용
      const urlParams = new URLSearchParams(window.location.search);
      const iw = parseInt(urlParams.get('iw'), 10);
      const ih = parseInt(urlParams.get('ih'), 10);
      const pl = parseInt(urlParams.get('pl'), 10);
      const pt = parseInt(urlParams.get('pt'), 10);
      const targetW = !isNaN(iw) ? iw : 679;
      const targetH = !isNaN(ih) ? ih : 480;
      window.resizeTo(targetW + chromeW, targetH + chromeH);
      // window.open이 left/top을 무시한 경우에도 정확한 위치로 이동
      if (!isNaN(pl) && !isNaN(pt)) {
        window.moveTo(pl, pt);
      }

      // 이전 팝업의 텍스트박스 화면 좌표(pbL/pbT/pbR/pbB)를 받아,
      // 이 창이 그 박스를 덮고 있으면 사방 중 화면 안에 들어가는 최소 이동으로 밀어낸다.
      const pbL = parseFloat(urlParams.get('pbL'));
      const pbT = parseFloat(urlParams.get('pbT'));
      const pbR = parseFloat(urlParams.get('pbR'));
      const pbB = parseFloat(urlParams.get('pbB'));
      if (!isNaN(pbL) && !isNaN(pbT) && !isNaN(pbR) && !isNaN(pbB)) {
        const curL = window.screenX;
        const curT = window.screenY;
        const curW = window.outerWidth;
        const curH = window.outerHeight;
        const curR = curL + curW;
        const curB = curT + curH;
        const overlapsBox = !(curR <= pbL || curL >= pbR || curB <= pbT || curT >= pbB);
        if (overlapsBox) {
          const moves = [
            { dx: pbR - curL + 8, dy: 0 },         // 오른쪽으로 밀기
            { dx: -(curR - pbL) - 8, dy: 0 },       // 왼쪽으로 밀기
            { dx: 0, dy: pbB - curT + 8 },          // 아래로 밀기
            { dx: 0, dy: -(curB - pbT) - 8 }        // 위로 밀기
          ].filter((c) => {
            const nl = curL + c.dx;
            const nt = curT + c.dy;
            return nl >= 0 && nt >= 0 && nl + curW <= window.screen.availWidth && nt + curH <= window.screen.availHeight;
          });
          if (moves.length > 0) {
            // 최소 이동량인 방향 선택
            moves.sort((a, b) => (Math.abs(a.dx) + Math.abs(a.dy)) - (Math.abs(b.dx) + Math.abs(b.dy)));
            const m = moves[0];
            window.moveTo(curL + m.dx, curT + m.dy);
          }
        }
      }
    } else {
      // 메인 탭: 내부 1358×960 (A4 가로 비율)
      window.resizeTo(1358 + chromeW, 960 + chromeH);
    }
  } catch (e) {
    /* 브라우저가 창 크기 조절을 허용하지 않으면 무시 */
  }

  // 1. URL 쿼리 파라미터가 있을 경우 아트보드 상태 복원
  ArtboardManager.loadStateFromUrl();

  // 창 크기가 바뀌어도 텍스트 박스가 1/16 면적을 유지하며 재배치되도록 처리
  window.addEventListener('resize', () => {
    ArtboardManager.layoutContentRandomly();
  });

  let lastSelectedText = '';

  // 2. 본문 드래그 텍스트 포착 이벤트
  document.addEventListener('mouseup', async () => {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    if (selectedText.length > 0 && selectedText !== lastSelectedText) {
      lastSelectedText = selectedText;

      // 드래그 즉시 크롤링 경로로 기록 + 드래그 텍스트 저장
      // (크롤링 완료 전에 엮기를 눌러도 팝업이 이 텍스트로 직접 크롤링해 위키백과로 연결)
      ArtboardManager.setDraggedText(selectedText);

      // 크롤링 로딩 상태 표출
      ArtboardManager.showLoading(selectedText);

      // 동적 위키백과 크롤링 실행
      const conceptResult = await WikiCrawler.crawl(selectedText);

      // 아트보드 상태 및 탐색 결과 UI 업데이트
      ArtboardManager.updateDemoState(conceptResult);
    }
  });

  // 3. 확정 버튼 클릭 시 새 창 출력 바인딩
  const confirmBtn = document.getElementById('confirmBtn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      ArtboardManager.openNewConceptWindow();
    });
  }
});
