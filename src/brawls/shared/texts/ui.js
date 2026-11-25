// 화면(메뉴 · 채널 목록 · 대기실 · 경기 HUD · 결과 · 설정 · 터치 조작부)에 보이는 문구.
// 여기 값을 고치면 게임에 그대로 반영된다(고친 뒤 다시 빌드해야 한다).
//
// 고칠 때 지킬 것
// ※ {name} · {n} 처럼 중괄호로 싼 자리는 게임이 값을 채워 넣는 곳이다. 지우거나 철자를 바꾸면 안 된다(위치는 옮겨도 된다).
// ※ 따옴표(" ") 안의 글자만 고친다. 왼쪽의 이름(예: tagline)과 쉼표 · 중괄호 · 대괄호는 그대로 둔다.
// ※ 문구 안에 큰따옴표를 쓰려면 \" 로 적는다.
// ※ "앞 / 강조 / 뒤" 라고 적힌 항목들은 한 문장을 셋으로 나눈 것이다(가운데만 강조 색으로 나온다).
//    이어 읽었을 때 한 문장이 되게 고치고, 띄어쓰기는 조각 끝에 직접 넣는다. 필요 없는 조각은 "" 로 비워 둔다.
export default {
  // 브라우저 탭 제목(index.html 의 <title> 과 같은 값으로 맞춰 둔다)
  title: "INK BRAWLS — 잉크 브로울스",
  // 검색 · 공유에 쓰이는 페이지 설명(index.html 의 description 과 같은 값)
  description: "잉크 브로울스(INK BRAWLS) — 팀이 함께 퀴즈 룸을 차지하고 문제를 푸는 형광 잉크 퀴즈 아케이드!",

  // 게임 이름(첫 화면의 큰 제목과 목록 · 대기실 왼쪽 위의 작은 제목)
  brand: {
    line1: "INK", // 제목 첫 줄
    line2: "BRAWLS", // 제목 둘째 줄
    full: "INK BRAWLS 잉크 브로울스", // 화면 읽기 프로그램이 읽는 이름
    marquee: "INK BRAWLS ✶ 잉크 브로울스 ✶ 다 함께 풀고, 던지고, 차지하세요! ✶", // 첫 화면 아래를 흘러가는 노란 띠
  },

  // 첫 화면: 닉네임 입력
  menu: {
    aria: "닉네임 입력", // 화면 읽기 프로그램용 화면 이름
    kicker: "TEAM QUIZ ARCADE · 최대 {max}인", // 제목 위의 작은 띠 — {max} 는 최대 인원
    tagline: "잉크 브로울스", // 제목 아래 노란 띠
    // 소개 글 두 줄 — 게임 설명 창의 규칙 탭 맨 위에 크게 보인다
    pitchLine1: "던지고, 터뜨리고, 밀어내세요!", // 첫 줄
    pitchBefore: "잉크를 뒤집어쓸수록 ", // 둘째 줄 — 앞
    pitchStrong: "더 멀리 날아갑니다.", // 둘째 줄 — 강조
    stamp: "선수 등록", // 입력 칸 모서리의 도장
    nameLabel: "닉네임", // 입력 칸 이름
    namePlaceholder: "비워 두면 자동으로 지어 드려요", // 빈 입력 칸에 흐리게 보이는 글
    enter: "입장", // 시작 버튼
    enterKey: "ENTER", // 시작 버튼 오른쪽의 키 표시
    connecting: "접속 중…", // 서버에 붙는 동안 시작 버튼에 뜨는 글
    fallbackName: "잉크", // 닉네임을 아직 모를 때 대신 보이는 이름
    help: "게임 설명", // 입장 버튼 아래: 게임 설명 창을 여는 버튼
    settings: "설정", // 입장 버튼 아래: 설정 창을 여는 버튼
  },

  // 게임 설명 창(첫 화면 · 채널 화면의 "게임 설명" 버튼, 경기 중 메뉴에서 연다). 안의 글은 아래 howto 를 쓴다
  help: {
    title: "게임 설명", // 창 위의 도장, 화면 읽기 프로그램용 이름
    open: "설명", // 채널 목록 · 대기실 오른쪽 위 버튼
    close: "닫기", // 아래 닫기 버튼
    closeAria: "게임 설명 닫기", // 오른쪽 위 × 버튼(화면 읽기 프로그램용)
    tabs: { rules: "규칙", quiz: "퀴즈 룸", controls: "조작법", items: "아이템", team: "팀 신호 · 채팅" }, // 창 안의 탭
  },

  // 게임 설명 창의 내용(조작법 · 규칙 · 아이템 탭)
  howto: {
    title: "조작법",
    // 키보드 · 마우스(왼쪽은 키 표시, 오른쪽은 설명)
    moveKeys: ["W", "A", "S", "D"],
    move: "이동",
    aimKey: "마우스",
    aim: "조준",
    throwKey: "왼쪽 버튼",
    throw: "던지기",
    throwHint: "길게 누르면 대형 풍선",
    dashKey: "WASD ×2",
    dash: "대시",
    dashHint: "방향키 두 번 · 잠깐 무적 · 박치기",
    jumpKey: "SPACE",
    jump: "점프",
    jumpHint: "공중에서 한 번 더 = 공중제비",
    weaponKey: "Q · E · 우클릭",
    weapon: "무기 바꾸기",
    weaponHint: "Q · 우클릭 다음, E 이전, 숫자 1~7",
    homingKey: "더블 클릭",
    homing: "유도 미사일",
    homingHint: "빠르게 두 번 클릭",
    // 터치 기기(휴대폰 · 태블릿)에서는 위 대신 아래가 보인다
    touchMoveKey: "왼쪽 화면",
    touchMove: "이동",
    touchMoveHint: "닿은 곳에 스틱이 생겨요",
    touchAimKey: "오른쪽 스틱",
    touchAim: "조준 · 던지기",
    touchAimHint: "끌어서 조준, 떼면 던지기",
    touchDashKey: "대시 버튼",
    touchDash: "대시",
    touchDashHint: "잠깐 무적 · 박치기",
    touchJumpKey: "점프 버튼",
    touchJump: "점프",
    touchJumpHint: "공중에서 한 번 더 = 공중제비",
    touchPointKey: "화면 터치",
    touchPoint: "그 자리로 발사",
    touchPointHint: "누른 곳으로 던지기",
    touchWeaponKey: "무기 막대",
    touchWeapon: "무기 바꾸기",
    touchWeaponHint: "누를 때마다 다음 무기",
    touchHomingKey: "두 번 톡톡",
    touchHoming: "유도 미사일",
    touchHomingHint: "빠르게 두 번 톡톡",
    // 규칙 한 줄
    ruleBefore: "상대의 체력을 다 깎으면 ", // 앞
    ruleStrong: "KO", // 강조
    ruleAfter: ". 잉크%가 높을수록 멀리 날아가요.", // 뒤
    itemRule: "기본 잉크는 저절로 차요. 맵의 아이템을 먹으면 특수 풍선이 생겨요.", // 그 아래 한 줄: 잉크 아이템 규칙
    hpRule: "에너지 아이템으로 체력을 채워요.", // 체력 · 에너지 규칙 한 줄
    padRule: "점프 보드를 밟으면 높이 튀어 올라요.", // 점프 보드 한 줄(규칙 탭)
    homingRule: "유도 미사일: 더블 클릭하면 가까운 적을 쫓아가요.", // 유도 미사일 한 줄(아이템 탭)
    // 경기 방식 설명. 앞에 경기 방식 이름(shared/texts/game.js 의 modes)이 굵게 붙는다
    modeQuizRule: "팀 전원이 퀴즈 룸에서 문제를 풀어요. 모든 문제를 먼저 푼 팀이 승리!",
    modeArcadeRule: "퀴즈 없는 팀 난투. 끝까지 많이 살아남은 팀이 승리!",
    fogRule: "안개: 우리 팀이 보는 곳에서만 적과 아이템이 보여요.",
    riverRule: "잉크 강은 다리로 건너요. 상자와 통은 폭발에 부서져요.",
    // 퀴즈 룸 탭: 푸는 순서
    quizSteps: [
      "화살표와 미니맵이 남은 룸을 가리켜요.",
      "팀 전원이 빛 고리 안에서 2초 버티면 입장! 한 룸에는 한 팀만 들어가요.",
      "위에 뜬 답 카드를 겨눠 던지세요(숫자 1~5 도 돼요). 친구의 답은 보이지 않아요.",
      "모두 맞히면 1문제 획득! 한 명이라도 틀리면 팀 전원이 홈으로.",
    ],
    quizBlockTitle: "다른 팀 막기",
    quizBlock: "고리 안의 적을 한 명만 밀어내도 그 팀은 처음부터!",
    quizTip: "X(여기로)로 갈 룸을 맞추고 함께 뭉쳐 들어가세요.",
    // 조작법 탭에 더한 줄
    cardKey: "1 ~ 5",
    card: "카드 고르기",
    cardHint: "풀이 중에만",
    chatKey: "ENTER",
    chat: "채팅",
    chatHint: "Tab 팀/전체",
    pingKey: "Z X C V",
    ping: "팀 신호",
    pingHint: "모여 · 여기로 · 막아 · 도와줘",
    touchCardKey: "답 카드",
    touchCard: "답 고르기",
    touchCardHint: "카드를 톡",
    touchTalkKey: "말 버튼",
    touchTalk: "채팅 · 팀 신호",
    touchTalkHint: "신호 · 자판",
    // 아이템 탭의 표
    itemHead: "아이템",
    itemEffect: "효과",
    itemGroups: { attack: "공격", block: "방해", support: "지원" },
    itemUse: "먹은 아이템은 무기 막대에 쌓여요. 종류마다 30개까지 쟁여 둘 수 있어요.",
    // 팀 신호 · 채팅 탭
    pingTitle: "팀 신호",
    pingRows: {
      gather: "모여!",
      go: "여기로! — 가리킨 룸을 팀 목표로",
      block: "막아!",
      help: "도와줘!",
    },
    chatTitle: "경기 중 채팅",
    chatRule: "Enter 로 열고 보내요. 기본은 팀 채팅, Tab 으로 전체.",
    teamplayTitle: "함께 싸우기",
    teamplayRule: "셋 이상 뭉치면 덜 밀려나고, 같은 자리에 함께 터뜨리면 더 크게 터져요.",
    // 메가 잉크 폭탄 모으는 법(아이템 탭의 소제목 · 순서 목록 · 덧붙임)
    fuseTitle: "메가 잉크 폭탄 모으기",
    fuseSteps: [
      "대왕 · 삼발 · 끈끈이 · 미사일 풍선을 한 번씩 먹으면",
      "메가 잉크 폭탄이 저절로 만들어져요!",
    ],
    fuseTip: "쓰러져도 모은 칸은 남아요.",
    // 부스터 아이템 한 줄 — {n} 은 부스터가 이어지는 초
    boostRule: "부스터: {n}초 동안 빨리 달리고 높이 뛰어요.",
    // 보호막 아이템 한 줄 — {n} 은 보호막이 이어지는 초
    shieldRule: "보호막: {n}초 동안 잉크를 튕겨 내요.",
  },

  // 채널 목록 화면
  lobby: {
    aria: "채널 목록", // 화면 읽기 프로그램용 화면 이름
    barTitle: "채널 목록", // 왼쪽 위 제목 옆의 흰 띠
    meLabel: "선수", // 오른쪽 위 내 닉네임 앞의 작은 글
    settings: "설정", // 오른쪽 위 설정 버튼
    listStamp: "열린 채널", // 목록 위의 도장(옆에 채널 수가 붙는다)
    // 목록이 비었을 때
    emptyTitle: "열린 채널이 없습니다",
    emptyBefore: "첫 채널을 열거나 ", // 안내 문장 — 앞
    emptyStrong: "빠른 시작", // 안내 문장 — 강조
    emptyAfter: "으로 바로 참여하세요!.", // 안내 문장 — 뒤
    // 목록의 한 줄
    rowHost: "방장 {name}", // 채널 이름 아래 작은 글 — {name} 은 방장 닉네임(맵 크기는 정원으로 정해져 따로 보이지 않는다)
    unknownHost: "?", // 방장 닉네임을 모를 때
    rowBots: "컴퓨터", // 봇으로 채우는 채널에 붙는 딱지
    rowTeams: "팀전", // 팀전 채널에 붙는 작은 딱지(경기 방식 이름은 shared/texts/game.js 의 modes)
    stateWaiting: "대기 중",
    statePlaying: "경기 중 · 난입", // 경기 중이지만 들어갈 수 있는 채널
    stateFull: "만원", // 자리가 없는 채널
    rowAria: "{name} 채널, {count}/{max}명, {state}", // 화면 읽기 프로그램이 한 줄을 읽는 문장
    // 오른쪽: 빠른 시작
    quick: "빠른 시작",
    quickHint: "자리 있는 채널로 곧장",
    // 오른쪽: 채널 개설
    makeTitle: "채널 개설",
    makeName: "채널 이름",
    makeNamePlaceholder: "난투장 이름", // 닉네임을 아직 모를 때 빈 칸에 흐리게 보이는 글
    defaultChannelName: "{name}의 전투", // 이름을 비우고 개설하면 붙는 채널 이름 — {name} 은 내 닉네임
    max: "정원",
    maxDown: "정원 줄이기", // − 버튼(화면 읽기 프로그램용)
    maxUp: "정원 늘리기", // + 버튼(화면 읽기 프로그램용)
    locked: "비공개",
    create: "개설",
    // 오른쪽: 코드로 입장
    codeTitle: "코드로 입장",
    codePlaceholder: "코드",
    codeAria: "채널 코드", // 화면 읽기 프로그램용 입력 칸 이름
    codeJoin: "입장",
  },

  // 채널 대기실 화면
  room: {
    aria: "채널 대기실", // 화면 읽기 프로그램용 화면 이름
    barTitle: "채널 대기실", // 왼쪽 위 제목 옆의 흰 띠
    settings: "설정", // 오른쪽 위 설정 버튼
    leave: "채널 나가기", // 오른쪽 위 나가기 버튼
    // 노란 채널 코드 딱지
    codeLabel: "채널 코드",
    codeHint: "눌러서 초대 링크 복사",
    codeCopied: "초대 링크 복사됨!", // 누른 직후 잠깐
    // 채널 이름 아래의 딱지들
    stateWaiting: "대기 중",
    statePlaying: "경기 중",
    locked: "비공개 · 코드로만 입장",
    open: "공개 채널",
    botsFill: "컴퓨터 플레이어 {n}", // {n} 은 봇이 채워 주는 최소 인원
    noBots: "컴퓨터 없음",
    mapBadge: "맵 {name}", // {name} 은 맵 크기 이름(보통 · 넓게 · 광활)
    teamsBadge: "팀전", // 팀전일 때 경기 방식 딱지 옆에 붙는 딱지
    // 선수 명단
    rosterStamp: "선수 명단",
    rosterCount: "{count} / {max}", // 도장 옆 인원 수
    host: "방장", // 방장 딱지
    you: "나", // 내 칸의 딱지
    memberReady: "준비 완료",
    memberWaiting: "대기",
    memberInGame: "경기 중",
    slotBot: "컴퓨터가 참여합니다", // 빈 칸 가운데 봇이 들어올 칸
    slotEmpty: "빈 자리",
    teamCount: "{n}명", // 팀전 명단 위 팀 이름 옆의 인원 수 — {n} 은 그 팀 사람 수(컴퓨터 제외)
    teamSwitch: "팀 바꾸기", // 팀전 대기실에서 상대 팀 이름 옆에 붙는 버튼(누르면 그 팀으로 옮긴다)
    teamSwitchAria: "{team}으로 옮기기", // 화면 읽기 프로그램용 — {team} 은 옮겨 갈 팀 이름
    teamCountLabel: "팀 수", // 방장 설정: 팀 수(2~6) 고르기 줄의 이름
    teamCountOpt: "{n}팀", // 팀 수 버튼 — {n} 은 팀 수
    shuffle: "팀 섞기", // 방장 설정: 사람을 무작위로 섞어 팀마다 고르게 나눈다
    balance: "자동 균형", // 방장 설정: 가장 적게 옮겨 팀 인원을 고르게 맞춘다
    // 방장 설정
    hostTape: "방장 설정",
    max: "정원",
    maxDown: "정원 줄이기", // − 버튼(화면 읽기 프로그램용)
    maxUp: "정원 늘리기", // + 버튼(화면 읽기 프로그램용)
    map: "맵 크기", // 맵 크기 고르는 버튼 줄의 이름(버튼 글자는 shared/texts/game.js 의 mapSizes)
    mode: "경기 방식", // 경기 방식 고르는 버튼 줄의 이름(버튼 글자는 shared/texts/game.js 의 modes)
    time: "제한 시간", // 제한 시간 고르는 버튼 줄의 이름
    timeOption: "{n}분", // 제한 시간 버튼 글자 — {n} 은 분
    // 아래 큰 버튼
    ready: "준비",
    readyDone: "준비 완료 ✓", // 준비를 누른 뒤
    start: "게임 시작", // 방장에게만 보인다
    startReady: "준비 {ready} / {total}", // 게임 시작 버튼 아래 작은 글 — 준비한 사람 수 / 방장을 뺀 사람 수
    startAloneBots: "혼자여도 컴퓨터와 붙는다", // 혼자이고 봇 채우기가 켜져 있을 때
    startAlone: "혼자서 연습", // 혼자이고 봇 채우기가 꺼져 있을 때
    // 버튼 옆 안내 한 줄
    hintPlaying: "경기가 진행 중입니다. 곧 입장합니다.",
    hintHost: "모두 모였으면 시작하세요. 코드를 누르면 초대 링크가 복사됩니다.",
    hintReady: "준비 완료. 방장이 시작하면 전투가 시작됩니다.",
    hintNotReady: "준비를 눌러 두면 방장이 시작해요.",
  },

  // 대기실의 채팅 창
  chat: {
    stamp: "채팅",
    placeholder: "할 말을 적고 Enter", // 빈 입력 칸에 흐리게 보이는 글
    aria: "채팅 입력", // 화면 읽기 프로그램용 입력 칸 이름
    send: "보내기",
  },

  // 경기 중 화면(HUD)
  hud: {
    menu: "메뉴", // 왼쪽 위 버튼
    menuKey: "ESC", // 그 옆의 키 표시
    // 가운데 위 시계
    roundDefault: "전투", // 라운드 번호가 없을 때 시계 위 작은 글
    round: "ROUND {n}", // 라운드 번호가 있을 때 — {n} 은 번호
    clockReady: "준비", // 시작 전 시계 자리
    clockEnd: "끝", // 끝난 뒤 시계 자리
    // 오른쪽 위 순위판
    boardTitle: "순위",
    boardHint: "잉크% · 점수",
    bot: "COM", // 봇 이름 옆 딱지
    out: "탈락", // 아케이드에서 탈락한 사람 줄(잉크% 자리)
    teamAlive: "생존 {n}", // 아케이드 순위판의 팀 줄 — {n} 은 살아남은 팀원 수
    percent: "{n}%", // 순위판과 머리 위 이름표의 잉크% — {n} 은 숫자
    // 왼쪽 아래 내 잉크%
    inkLabel: "내 잉크",
    inkUnit: "%", // 큰 숫자 옆의 단위
    warnDanger: "위험!", // 잉크가 100% 를 넘었을 때
    warnDeadly: "한 방이면 끝!", // 잉크가 150% 를 넘었을 때
    // 가운데 아래 탄약 · 충전 · 대시
    ammoAria: "잉크 풍선", // 화면 읽기 프로그램용
    weaponAria: "무기 바꾸기", // 무기 막대(누르면 다음 무기) — 화면 읽기 프로그램용
    weaponKey: "Q · 우클릭", // 무기 막대 옆에 보이는 키 표시(다음 무기)
    ammoEmpty: "잉크 없음! 곧 다시 차요", // 잉크가 0발일 때 탄약 자리에 깜빡이는 문구(기본 잉크는 저절로 찬다)
    // 무기 막대 옆의 메가 잉크 폭탄 합성 칸(특수 풍선 네 가지를 한 번씩 먹을 때마다 한 칸씩 켜진다)
    fuseLabel: "합성", // 네 칸 앞의 작은 글
    fuseCount: "{n}/4", // 켜진 칸 수 — {n} 은 0~4
    fuseAria: "메가 잉크 폭탄 합성 {n} / 4", // 화면 읽기 프로그램용
    fuseDone: "합성!", // 폭탄이 합성되는 순간 칸 위에 튀어나오는 글
    // 부스터(이동 · 점프 강화) 남은 시간 표시
    boostLabel: "부스터",
    boostSec: "{n}", // 남은 초 — {n} 은 숫자(소수 한 자리)
    boostAria: "부스터 남은 시간 {n}초", // 화면 읽기 프로그램용
    shieldLabel: "보호막",
    rangeLabel: "롱샷", // 롱샷(사거리 늘림) 남은 시간 띠
    rangeAria: "롱샷 남은 시간 {n}초", // 화면 읽기 프로그램용
    droneLabel: "드론", // 던전: 드론을 타고 나는 남은 시간 띠
    droneAria: "드론 남은 시간 {n}초", // 화면 읽기 프로그램용
    shieldAria: "보호막 남은 시간 {n}초", // 화면 읽기 프로그램용
    chargeFull: "대형!", // 충전이 꽉 찼을 때
    scrum: "스크럼", // 같은 팀 셋 이상이 붙어 넉백을 덜 받을 때 이름표 위 작은 딱지(서버 문구 game.js 의 gadgetUsed.scrum 이 있으면 그것)
    dash: "대시",
    dashKey: "WASD×2", // 대시 표시 옆 키 표시(같은 방향키 두 번)
    jump: "점프",
    jumpKey: "SPACE",
    // 가운데 아래 체력 게이지
    hpLabel: "체력",
    hpAria: "체력 {n} / {max}", // 화면 읽기 프로그램용
    // 쓰러진 뒤(퀴즈 모드: 곧 부활)
    deadTitle: "K.O.",
    respawnBefore: "부활까지 ", // 남은 초 숫자의 앞
    respawnAfter: "", // 남은 초 숫자의 뒤
    // 아케이드에서 탈락한 뒤(부활 없음)
    outTitle: "OUT",
    outSub: "탈락 · 관전 중",
    // 왼쪽 위 킬 피드
    feedKo: "KO", // 쓰러뜨린 사람과 쓰러진 사람 사이
    feedFell: "다운", // 누구에게 맞지 않고 혼자 쓰러진 사람 이름 뒤
    unknownName: "?", // 이름을 알 수 없을 때
    // 오른쪽 아래 연결 상태
    netWs: "WS",
    netRtc: "RTC",
    netFps: "{n} FPS", // {n} 은 초당 프레임 수
    netPing: "{n} ms", // {n} 은 지연(밀리초)
    netPingNone: "-- ms", // 아직 잰 값이 없을 때
  },

  // 결과 화면
  results: {
    title: "결과", // 내 순위를 모를 때의 큰 제목
    winTitle: "우승!", // 내가 1위일 때
    rankTitle: "{n}위", // 그 밖의 순위 — {n} 은 순위
    kicker: "경기 종료", // 제목 옆 흰 띠
    winKicker: "잉크의 왕", // 내가 1위일 때 그 자리
    hpWinKicker: "최후의 생존자", // 아케이드에서 내가 이겼을 때 그 자리
    teamWinTitle: "승리!", // 팀전에서 우리 팀이 이겼을 때
    teamLoseTitle: "패배", // 팀전에서 우리 팀이 졌을 때
    drawTitle: "무승부", // 팀전에서 비겼을 때
    teamWin: "승리", // 팀 점수판에서 이긴 팀에 붙는 도장
    teamWinKicker: "{team} 승리", // 팀전 결과 제목 옆 흰 띠 — {team} 은 이긴 팀 이름
    teamDraw: "무승부", // 비겼을 때 두 팀 사이에 붙는 글
    vs: "VS", // 두 팀 사이
    teamScoreUnit: "KO", // 팀 점수 옆 단위(퀴즈 모드 — M4 에서 맞힌 수로 바뀐다)
    teamAliveUnit: "생존", // 팀 점수 옆 단위(아케이드: 살아남은 사람 수)
    alive: "생존", // 아케이드 결과 줄: 살아남은 사람
    out: "탈락", // 아케이드 결과 줄: 탈락한 사람
    you: "나", // 내 줄의 딱지
    scoreUnit: "KO", // 점수 옆 단위
    nextBefore: "대기실로 돌아가기까지 ", // 남은 초 숫자의 앞
    nextAfter: "", // 남은 초 숫자의 뒤
  },

  // 설정(첫 화면 · 채널 화면의 설정 창, 그리고 경기 중 메뉴 안)
  settings: {
    title: "설정",
    quality: "화질",
    qualityOptions: { low: "저", mid: "중" }, // 저: 해상도를 낮춰 가볍게 / 중: 기본
    master: "전체 음량",
    music: "음악",
    sfx: "효과음",
  },

  // 경기 중 메뉴(ESC 또는 왼쪽 위 메뉴 버튼)
  sheet: {
    title: "메뉴", // 도장, 화면 읽기 프로그램용 이름
    note: "경기는 멈추지 않는다.",
    leaveAsk: "게임을 나가겠습니까?", // 경기 중에 브라우저 뒤로가기를 눌렀을 때 메뉴에 뜨는 질문
    leave: "경기 나가기",
    resume: "계속하기",
    close: "닫기", // 경기 밖(첫 화면 · 채널 화면)에서 설정 창을 열었을 때 아래 버튼
    help: "게임 설명", // 경기 중 메뉴 안에서 게임 설명 창을 여는 버튼
  },

  // 터치 조작부(휴대폰 · 태블릿에서 경기 중에만 보인다)
  touch: {
    aria: "터치 조작부", // 화면 읽기 프로그램용
    move: "이동", // 왼쪽 스틱 손잡이
    aim: "조준", // 오른쪽 스틱 손잡이
    dash: "대시", // 대시 버튼
    jump: "점프", // 점프 버튼(대시 버튼 곁)
  },

  // 화면 위에 잠깐 뜨는 한 줄 알림
  toast: {
    codeTooShort: "채널 코드는 4글자", // 코드로 입장에서 4글자를 다 적지 않았을 때
    inviteCopied: "초대 링크를 복사했습니다", // 채널 코드를 눌러 초대 링크를 복사했을 때
    // 저사양 기기 보호: 화면이 버거우면 화질을 스스로 낮추고 알린다 — {name} 은 화질 이름(저 · 중)
    qualityLowered: "화면이 버거워 화질을 '{name}'(으)로 낮췄습니다",
    resolutionLowered: "화면이 버거워 해상도를 낮췄습니다",
    contextLost: "그래픽 장치가 잠시 멈췄습니다. 다시 그릴 때까지 기다립니다…", // 브라우저가 그래픽 연결을 끊었을 때
    contextRestored: "화면을 되살렸습니다(화질 '{name}')",
    contextDead: "그래픽 장치가 응답하지 않습니다. 페이지를 새로 고쳐 주세요", // 한참 기다려도 돌아오지 않을 때
    reconnecting: "연결이 끊겼습니다. 다시 연결하는 중…", // 경기 중 잠깐 끊겼을 때(자리는 1분 동안 남아 있다)
    reconnected: "다시 연결됐습니다", // 같은 자리로 돌아왔을 때
    reconnectFailed: "자리를 되찾지 못했습니다. 채널 목록으로 돌아갑니다", // 1분이 지나 자리가 사라졌을 때
    linkCopied: "초대 링크를 복사했습니다", // 링크 복사 버튼
    excludedMe: "방장이 나를 퀴즈 인원에서 뺐습니다(존 입장 · 정답 인원에 세지 않음)",
    includedMe: "방장이 나를 퀴즈 인원으로 되돌렸습니다",
    csvSaved: "결과 CSV 를 내려받았습니다",
  },

  // 대기실 · 채널 만들기에 더한 설정(퀴즈 · 컴퓨터 · 채팅 · 아이템 · 진행자 · 입장)
  setup: {
    quiz: "퀴즈", // 퀴즈 세트 줄의 이름
    quizNone: "아직 고른 퀴즈가 없습니다", // 퀴즈 모드인데 고른 퀴즈가 없을 때
    quizCount: "{n}문항", // 고른 퀴즈 제목 옆 — {n} 은 문항 수
    quizPick: "퀴즈 고르기", // 아카이브 창을 여는 버튼
    quizChange: "바꾸기", // 이미 고른 퀴즈가 있을 때 그 버튼
    quizClear: "빼기", // 고른 퀴즈를 지우는 버튼
    qcount: "문제 수",
    qcountOpt: "{n}문제",
    qcountAll: "전부",
    solve: "풀이 시간",
    solveOpt: "{n}초",
    shuffleQ: "문제 섞기",
    shuffleC: "선택지 섞기",
    bots: "컴퓨터", // 요약 카드의 컴퓨터 칸 이름
    botsOff: "없음", // 요약 카드: 컴퓨터를 넣지 않았을 때
    botLevels: { low: "하", mid: "중", high: "상" },
    chat: "경기 채팅",
    chatModes: { free: "켬", off: "끔" }, // 빠른 말은 없다(v13 — 직접 입력만)
    items: "아이템",
    itemModes: { all: "전부", basic: "기본만" },
    fog: "안개", // 전장의 안개(docs/DESIGN.md §3.8)
    fogModes: { on: "켬", off: "끔" },
    fogHint: "켜면 우리 팀이 보는 곳만 밝게 보이고, 다른 팀은 시야 안에서만 보입니다",
    teams: "팀",
    presenter: "진행자 화면으로 보기", // 방장: 캐릭터 없이 교실 큰 화면으로 보기
    presenterOn: "진행자 화면으로 봅니다(캐릭터 없음)", // 켜져 있을 때 버튼 아래 안내
    presenterBadge: "진행자", // 명단의 진행자 딱지
    away: "자리 비움", // 접속이 끊겨 자리만 남은 사람의 딱지
    startNeedQuiz: "퀴즈를 먼저 골라 주세요", // 퀴즈 모드인데 고른 퀴즈가 없어 시작을 막을 때
    startNeedQuizHint: "퀴즈 모드는 퀴즈 세트가 있어야 시작할 수 있어요. '퀴즈 고르기'를 누르거나 아케이드 모드로 바꾸세요.",
    linkCopy: "링크 복사",
    qrShow: "QR 크게",
    qrTitle: "휴대폰 카메라로 찍으면 바로 들어옵니다",
    qrCode: "채널 코드 {code}",
    qrClose: "닫기",
    qrTooLong: "주소가 길어 QR 을 만들지 못했습니다. 코드를 불러 주세요",
    teamJoin: "이 팀으로", // 다른 팀 머리의 옮기기 버튼
    teamFull: "{n}명", // 팀 머리의 인원 — {n} 은 사람 수
    presenters: "진행자", // 명단 아래 진행자 줄의 이름
    rosterTotal: "{count}명 · 정원 {max}", // 명단 도장 옆
    makeMode: "경기 방식", // 채널 개설 칸의 방식 줄
    makeQuizHint: "퀴즈 모드는 퀴즈를 고르면 바로 열 수 있어요(나중에 대기실에서 바꿔도 됩니다)",
    makeNeedQuiz: "퀴즈를 고르거나 아케이드 모드로 열어 주세요",
    moreSettings: "자세한 설정", // 접어 둔 설정 묶음
    // 대기실의 설정 요약 한 줄 · 설정 창(방장)
    sumQuestions: "{n}문제", // 요약: 퀴즈 제목 옆 문제 수
    sumSolve: "풀이 {n}초",
    sumNoQuiz: "퀴즈를 골라 주세요",
    sumNotes: { chatOff: "채팅 끔", basic: "아이템 기본만", fogOff: "안개 끔", locked: "비공개" }, // 기본값과 다른 것만 요약 뒤에 흐리게
    open: "경기 설정", // 방장: 설정 창을 여는 버튼
    openHint: "모드 · 퀴즈 · 팀 · 시간", // 그 버튼 아래 작은 글
    panelTitle: "경기 설정", // 설정 창 도장
    basic: "기본",
    more: "더 보기", // 기본 세 줄 아래, 누르면 섹션별 설정이 펼쳐진다
    moreClose: "접기", // 펼친 뒤의 같은 버튼
    // 더 보기 안의 섹션 제목(docs/DESIGN.md §2.10b)
    sections: { quiz: "퀴즈", team: "팀", rules: "경기 규칙", run: "진행" },
    shuffleRow: "섞기", // 퀴즈 섹션: 문제 섞기 · 선택지 섞기 줄의 이름
    teamTools: "팀 나누기", // 팀 섹션: 팀 섞기 · 자동 균형 줄의 이름
    runRow: "진행자", // 진행 섹션: 진행자 화면으로 보기 줄의 이름
    done: "확인", // 설정 창 닫기(닫고 대기실로)
    close: "닫기",
    helpAria: "{name} 도움말", // 물음표 버튼(화면 읽기 프로그램용)
    help: {
      mode: "퀴즈 모드는 팀이 함께 퀴즈 룸을 차지해 문제를 풀고, 아케이드 모드는 퀴즈 없이 살아남기 대결입니다",
      kind: "던전은 팀마다 따로인 길에서 몬스터를 물리치며 가운데로 가는 경주예요. 팀끼리 싸우지 않고 서로 보이지 않아요. 퀴즈 모드면 몬스터를 물리칠 때마다 문제가 나오고, 못 맞히면 몬스터가 다시 살아나요(4팀까지)",
      quiz: "아카이브에서 고르거나 직접 만든 퀴즈를 씁니다",
      teams: "2~6팀. 팀 섞기는 무작위로, 자동 균형은 가장 적게 옮겨 인원을 맞춥니다",
      time: "경기 전체의 제한 시간입니다. 퀴즈 모드는 모든 문제를 먼저 푼 팀이 시간 전에 끝냅니다",
      qcount: "고른 퀴즈에서 낼 문제 수입니다",
      solve: "룸에 들어간 팀이 답을 모으는 시간입니다",
      shuffle: "문제 순서와 카드 순서를 경기마다 섞습니다",
      max: "채널 정원입니다. 사람과 컴퓨터를 합해 이만큼까지 들어옵니다(컴퓨터는 명단의 + 컴퓨터로 넣어요)",
      chat: "끄면 경기 중 채팅을 쓸 수 없어요. 팀 신호(Z · X · C · V)는 늘 됩니다",
      items: "기본만이면 새 아이템 9종(폭죽 · 장벽 · 연막 등)이 나오지 않습니다",
      fog: "켜면 우리 팀이 보는 곳만 밝게 보이고, 다른 팀은 시야 안에서만 보입니다",
      presenter: "방장이 캐릭터 없이 교실 큰 화면용 진행자 화면으로 봅니다",
    },
    // 대기실 명단의 컴퓨터(docs/DESIGN.md §2.10b — 방장이 팀마다 직접 넣고 뺀다. 경기를 시작하면 이대로 들어온다)
    botAdd: "+ 컴퓨터", // 방장: 팀 열 맨 아래의 넣기 버튼
    botAddAria: "{team}에 컴퓨터 넣기",
    botAddFull: "정원이 찼어요", // 정원이 차서 흐려진 넣기 버튼의 작은 글
    botRemove: "×", // 방장: 컴퓨터 줄의 빼기 버튼
    botRemoveAria: "{name} 빼기",
    botLevel: "컴퓨터 난이도", // 명단 머리의 작은 선택(하 · 중 · 상)
    botLevelHelp: "퀴즈 모드에서 사람이 없는 컴퓨터 팀의 정답률입니다(하 40% · 중 65% · 상 85%)",
    teamHumans: "사람 {n}", // 팀 머리 인원: 사람 수
    teamBots: "컴퓨터 {n}", // 팀 머리 인원: 컴퓨터 수
    sumBots: "컴퓨터 {n}", // 요약 한 줄 끝에 붙는 컴퓨터 수
    // 들어오자마자 뜨는 창
    becameHost: "방장이 되었어요. 경기 설정을 확인해 주세요", // 방장 자리를 넘겨받았을 때
    joined: "{name} 님이 들어왔어요", // 설정 창 · 요약 카드가 떠 있는 동안 누가 들어왔을 때
    cardTitle: "이번 판", // 손님에게 보이는 읽기 전용 요약 카드의 도장
    cardHint: "방장이 정한 설정이에요. 준비를 누르고 시작을 기다려요",
    cardRows: { mode: "경기 방식", kind: "유형", quiz: "퀴즈", qcount: "문제 수", solve: "풀이 시간", time: "제한 시간", teams: "팀", bots: "컴퓨터", chat: "경기 채팅", items: "아이템", fog: "안개" },
    // 경기 유형(v15 — docs/DESIGN.md §2.15): 두 모드 모두에 고른다. 이름은 shared/texts/game.js 의 kinds
    kind: "유형", // 경기 설정 창의 기본 줄 이름
    kindDungeonTeams: "던전은 4팀까지예요", // 던전일 때 팀 수 줄 아래 작은 글
    sumDungeon: "던전", // 대기실 요약 한 줄에 붙는 유형
    cardBots: "{level} · {n}명", // 요약 카드의 컴퓨터 칸 — {level} 하 · 중 · 상, {n} 들어올 수
    kick: "내보내기", // 방장: 명단 줄의 내보내기 버튼
    kickAria: "{name} 내보내기",
    kickAsk: "{name} 님을 채널에서 내보낼까요?",
  },

  // 첫 화면(채널 목록): 큰 선택 셋 · 방 만들기 단계
  front: {
    make: "방 만들기",
    makeHint: "퀴즈나 아케이드 방을 열고 친구를 초대해요",
    quick: "빠른 시작",
    quickHint: "컴퓨터와 바로 한 판(아케이드)",
    code: "코드로 입장",
    codeHint: "친구에게 받은 4글자",
    maxHint: "사람 + 컴퓨터", // 방 만들기의 정원 옆 작은 글(컴퓨터는 대기실 명단에서 넣는다)
    listTitle: "열린 채널",
    empty: "지금 열린 채널이 없어요. 방을 만들거나 빠른 시작으로 바로 놀아 보세요.",
    makeAria: "방 만들기",
    step1: "어떤 경기를 할까요?",
    modeQuiz: "팀이 함께 퀴즈 룸을 차지하고 문제를 풀어요. 모든 문제를 먼저 푼 팀이 승리!",
    modeArcade: "퀴즈 없는 팀 난투. 시간이 끝났을 때 더 많이 살아남은 팀이 승리!",
    changeMode: "모드 바꾸기",
    more: "더 보기", // 채널 이름 · 정원 · 컴퓨터 · 비공개
    create: "방 만들기",
    needQuiz: "퀴즈를 먼저 골라 주세요",
  },

  // 퀴즈 아카이브 창(채널 만들기 · 대기실의 "퀴즈 고르기")
  archive: {
    title: "퀴즈 고르기",
    tabs: { browse: "아카이브에서 고르기", mine: "내 퀴즈", create: "새로 만들기" },
    close: "닫기",
    searchLabel: "퀴즈 검색",
    searchPlaceholder: "제목 · 태그 · 문제로 찾기",
    levelLabel: "학교급",
    gradeLabel: "학년",
    subjectLabel: "교과",
    all: "전체",
    sortLabel: "정렬",
    sort: { popular: "인기순", recent: "최신순" },
    count: "{n}문항",
    plays: "{n}번 플레이",
    likes: "좋아요 {n}",
    by: "만든 사람 {name}",
    anon: "익명",
    more: "20개 더 보기",
    empty: "찾는 퀴즈가 없어요. 낱말을 바꾸거나 새로 만들어 보세요",
    loading: "불러오는 중…",
    failed: "불러오지 못했어요",
    retry: "다시 시도",
    unavailable: "퀴즈 아카이브를 지금 쓸 수 없어요. 아케이드 모드로 놀거나 잠시 뒤에 다시 열어 주세요.",
    preview: "미리 보기",
    back: "목록으로",
    use: "이 퀴즈로 하기",
    like: "좋아요",
    unlike: "좋아요 취소",
    report: "신고",
    reportAsk: "이 퀴즈를 신고할까요? 신고가 쌓이면 아카이브에서 숨겨집니다.",
    reported: "신고했어요. 살펴볼게요",
    fork: "복사해서 고치기",
    forked: "내 퀴즈로 복사했어요. 고쳐서 저장하세요",
    answer: "정답",
    explain: "해설",
    private: "비공개",
    public: "공개",
    hidden: "숨겨짐(신고)",
    mineEmpty: "아직 만든 퀴즈가 없어요. '새로 만들기'에서 시작하세요",
    edit: "고치기",
    remove: "지우기",
    removeAsk: "'{title}' 을(를) 지울까요? 되돌릴 수 없어요.",
    removed: "지웠어요",
    exportMine: "내 퀴즈 내보내기",
    importMine: "가져오기",
    exported: "내 퀴즈 {n}개를 파일로 내보냈어요",
    imported: "{n}개를 가져왔어요",
    importedKey: "이 기기가 파일의 열쇠로 내 퀴즈를 고칠 수 있게 됐어요",
    importBad: "잉크 브로울스 퀴즈 파일이 아니에요",
    importAsk: "파일의 열쇠로 바꿀까요? 이 기기에서 만든 퀴즈는 지금 열쇠가 담긴 내보내기 파일로만 다시 고칠 수 있어요.",
    keyNote: "가입이 없어서 퀴즈는 이 기기에 저장된 열쇠로 '내 것'이 됩니다. 다른 기기에서 고치려면 '내 퀴즈 내보내기' 파일을 옮겨 '가져오기' 하세요. 그 파일을 가진 사람은 내 퀴즈를 고칠 수 있으니 조심해서 두세요.",
    picked: "'{title}' 퀴즈를 골랐어요",
    exportFile: "잉크브로울스-내퀴즈.json",
  },

  // 퀴즈 편집기(아카이브 창의 "새로 만들기" · "고치기")
  editor: {
    newTitle: "새 퀴즈",
    editTitle: "퀴즈 고치기",
    title: "제목",
    titlePlaceholder: "예) 물질의 상태 10문제",
    description: "설명",
    descriptionPlaceholder: "어떤 퀴즈인지 한두 줄(선택)",
    level: "학교급",
    grade: "학년",
    subject: "교과",
    tags: "태그",
    tagsPlaceholder: "쉼표로 나눠요(예: 과학, 물)",
    visibility: "공개 범위",
    public: "공개 — 아카이브에서 누구나 찾을 수 있어요",
    private: "비공개 — 나와 이 퀴즈를 쓴 채널만",
    questions: "문항",
    qNumber: "{n}번",
    qText: "문제",
    qTextPlaceholder: "문제를 적어 주세요",
    choice: "보기 {n}",
    choicePlaceholder: "보기",
    answerAria: "{n}번 보기를 정답으로",
    answerMark: "정답",
    addChoice: "+ 보기",
    removeChoice: "보기 지우기",
    explanation: "해설(선택)",
    explanationPlaceholder: "맞힌 팀에게 잠깐 보여요",
    up: "위로",
    down: "아래로",
    removeQ: "문항 지우기",
    addQ: "+ 문항 추가",
    paste: "붙여넣기로 한꺼번에 만들기",
    pasteOpen: "붙여넣기 칸 열기",
    pasteHelp: "한 문항은 문제 한 줄, 정답 보기는 * 로, 오답 보기는 - 로 시작하고, 해설은 > 로 시작해요(없어도 돼요). 문항 사이는 빈 줄로 나눠요. 한글 · 엑셀에서 복사해 붙여도 됩니다.",
    pasteExample: "1. 물이 끓는 온도는? (1기압)\n* 100℃\n- 50℃\n- 0℃\n> 1기압에서 물은 100℃에서 끓어요.\n\n2. 대한민국의 수도는?\n- 부산\n* 서울\n- 대구",
    pasteLabel: "붙여넣을 글",
    pasteAppend: "뒤에 더하기",
    pasteReplace: "모두 바꾸기",
    pasteDone: "{n}문항을 만들었어요",
    pasteNone: "만들 문항을 찾지 못했어요. 예시 형식을 확인해 주세요",
    pasteIssues: "{n}곳을 확인해 주세요(문항은 만들어 두었어요)",
    pasteErrors: {
      orphan: "{line}번째 줄: 문제 없이 보기나 해설이 나왔어요",
      noChoices: "{line}번째 줄: 보기가 없어요(* 정답, - 오답)",
      fewChoices: "{line}번째 줄: 보기가 2개 이상이어야 해요",
      manyChoices: "{line}번째 줄: 보기는 5개까지예요",
      noAnswer: "{line}번째 줄: 정답 보기(* 로 시작)가 없어요",
      manyAnswers: "{line}번째 줄: 정답(*)은 하나만",
      textLong: "{line}번째 줄: 문제는 120자까지",
      choiceLong: "{line}번째 줄: 보기는 40자까지",
      explainLong: "{line}번째 줄: 해설은 200자까지",
      tooMany: "문항은 50개까지예요",
    },
    counter: "{n}/{max}",
    limits: "최대 50문항 · 문제 120자 · 보기 2~5개(각 40자) · 해설 200자",
    save: "저장",
    saveUse: "저장하고 이 퀴즈로 하기",
    saving: "저장 중…",
    saved: "저장했어요",
    remove: "이 퀴즈 지우기",
    discardAsk: "고친 내용을 버리고 나갈까요?",
    author: "만든 사람 이름(선택)",
    issuesTitle: "저장하기 전에 확인해 주세요",
    issues: {
      title_empty: "제목을 적어 주세요",
      title_long: "제목이 길어요({n}/{max})",
      description_long: "설명이 길어요({n}/{max})",
      tags_many: "태그는 {max}개까지예요",
      tag_long: "태그가 길어요({n}/{max})",
      questions_few: "문항을 하나 이상 만들어 주세요",
      questions_many: "문항은 {max}개까지예요({n}개)",
      text_empty: "{q}: 문제가 비었어요",
      text_long: "{q}: 문제가 길어요({n}/{max})",
      choices_few: "{q}: 보기가 2개 이상이어야 해요",
      choices_many: "{q}: 보기는 5개까지예요",
      choice_empty: "{q}: 빈 보기가 있어요",
      choice_long: "{q}: 보기가 길어요({n}/{max})",
      answer_empty: "{q}: 정답을 골라 주세요",
      explanation_long: "{q}: 해설이 길어요({n}/{max})",
    },
  },

  // 경기 중 퀴즈 HUD(팀별 진행 · 입장 · 풀이 · 화살표 · 알림)
  quiz: {
    rooms: ["A", "B", "C", "D", "E"], // 퀴즈 룸 이름(룸 번호 순서)
    room: "{name}룸", // 룸 이름 — {name} 은 위 글자
    progress: "{solved}/{n}", // 팀 띠의 맞힌 수 / 문제 수
    progressAria: "{team} {solved} / {n} 문제", // 화면 읽기 프로그램용
    alive: "생존 {n}", // 아케이드: 팀 띠의 살아남은 수
    aliveAria: "{team} 생존 {n}명",
    mine: "우리 팀", // 팀 띠에서 우리 팀 표시
    entry: "우리 팀 {in}/{need} 입장", // 존 쟁탈 중 — 안에 들어간 수 / 필요한 수
    entryGo: "모두 고리 안으로!", // 그 아래 안내
    entryAll: "전원 입장! {s}초", // 팀 전원이 고리 안 — 게이지가 차는 중({s} = 남은 초, 소수 한 자리)
    entryHold: "그대로 버텨요!", // 전원이 고리 안일 때 그 아래 안내
    reentry: "{s}초 뒤 다시 들어갈 수 있어요", // 이 룸의 풀이를 막 마친 우리 팀(재입장 대기)
    outside: "밖: {names}", // 아직 밖에 있는 팀원 — {names} 는 이름들
    outsideMore: "{names} 외 {n}명",
    others: "{team}도 차지하는 중!", // 같은 룸에서 다른 팀 게이지도 차고 있을 때
    solving: "풀이 {n}초", // 우리 팀이 풀이 중 — {n} 은 남은 초
    solvingSubmitted: "풀이 {n}초 · 제출 {sub}/{need}", // 제출한 수까지 — {sub} 제출한 수, {need} 팀 인원
    submitted: "「{name}」 님이 정답을 제출했어요~", // 팀원이 처음 제출할 때 화면 가운데 스플래시
    submitCount: "{n} / {need}", // 스플래시 옆 큰 숫자(지금까지 제출한 수 / 인원)
    solveHint: "각자 답 카드에 던지세요 — 모두 맞혀야 통과!",
    solveKeys: "카드를 겨눠 클릭 · 숫자 1~5",
    solveTouch: "각자 답 카드를 톡 — 모두 맞혀야 통과!",
    votes: "{n}명", // 카드 버튼에 붙는 같은 팀 표 수
    cardAria: "{n}번 카드: {text}",
    left: "남은 문제", // 우리 팀이 남긴 룸별 문제 수 줄의 이름
    leftRoom: "{room} {n}", // 한 칸 — {room} 룸 이름, {n} 남은 수
    allDone: "모든 문제 완료!",
    locked: "{team} 풀이 중", // 다른 팀이 풀고 있는 룸
    target: "목표", // 팀 목표 룸 화살표의 딱지
    arrow: "{room} · {n}", // 화살표 딱지 — 룸 이름 · 남은 문제 수
    entered: "입장!", // 우리 팀이 룸에 들어갔을 때(큰 글자)
    enteredSub: "{room} — 각자 답 카드에 던지세요",
    success: "정답!",
    successSub: "{team} {solved}/{n}",
    fail: "실패!", // 팀이 통과하지 못했다(누가 틀렸는지 · 정답은 알려 주지 않는다)
    timeout: "시간 초과!",
    failSub: "모두 맞혀야 해요 — 다시 도전!",
    gone: "풀이가 풀렸습니다", // 센 사람이 모두 빠져 판정 없이 풀림
    teamProgress: "{team} {solved}/{n}!", // 다른 팀이 맞혔을 때(작은 알림)
    teamEntered: "{team}이(가) {room}에 들어갔다",
    reward: "보상: {item} · 체력 가득", // 성공 보상(우리 팀)
    bombReward: "메가 잉크 폭탄 획득!", // 첫 도전에 맞혀 가장 먼저 던진 사람
    push: "밀어내기!", // 내가 상대를 존 밖으로 밀어냈다
    homeWarp: "홈으로!",
    explain: "해설",
    winner: "{team} 모든 문제 완료!",
  },

  // 경기 중 채팅 · 팀 신호(docs/DESIGN.md §2.13 · §2.14)
  talk: {
    open: "채팅", // 채팅 여는 키 안내 옆 글
    openKey: "ENTER",
    team: "팀", // 팀 채팅 딱지
    all: "전체", // 전체 채팅 딱지
    tabHint: "Tab 팀 ↔ 전체",
    placeholderTeam: "우리 팀에게(Enter 보내기 · Esc 닫기)",
    placeholderAll: "모두에게(Enter 보내기 · Esc 닫기)",
    inputAria: "경기 채팅 입력",
    send: "보내기",
    off: "이 채널은 채팅이 꺼져 있어요(팀 신호 Z · X · C · V 는 됩니다)",
    pings: { gather: "모여!", go: "여기로!", block: "막아!", help: "도와줘!" }, // 팀 신호 말풍선
    pingKeys: { gather: "Z", go: "X", block: "C", help: "V" },
    pingGo: "{room}으로!", // "여기로" 신호가 룸을 가리켰을 때 — {room} 은 "A룸" 같은 룸 이름
    signals: "팀 신호",
    bubble: "말", // 터치: 말풍선 버튼
    bubbleAria: "채팅 · 팀 신호 열기",
    keyboard: "자판", // 터치: 글자 입력 열기
    logAria: "경기 채팅 기록",
    tagTeam: "팀",
    tagAll: "전체",
  },

  // 무기 막대 · 아이템(이름은 shared/texts/game.js 를 먼저 쓰고, 없으면 여기 name 을 쓴다)
  items: {
    basic: { name: "기본 잉크", desc: "기본 풍선. 길게 누르면 대형" },
    mega: { name: "대왕 풍선", desc: "넓고 세게 터진다" },
    triple: { name: "삼발 풍선", desc: "부채꼴로 세 발" },
    sticky: { name: "끈끈이 풍선", desc: "맞으면 한동안 느려진다" },
    missile: { name: "잉크 미사일", desc: "곧게 날아 처음 닿는 곳에서 터진다" },
    bomb: { name: "메가 잉크 폭탄", desc: "경기장을 뒤집는 핵폭발" },
    homing: { name: "유도 미사일", desc: "더블 클릭으로 적을 쫓아간다" },
    firework: { name: "폭죽", desc: "터진 뒤 둘레 여섯 곳이 연쇄 폭발 — 모인 팀을 흩뜨린다" },
    vortex: { name: "소용돌이", desc: "2초 동안 적을 가운데로 끌어당긴 뒤 터진다" },
    drill: { name: "드릴 미사일", desc: "부서지는 블록을 3개까지 뚫고 날아간다" },
    wall: { name: "잉크 장벽", desc: "조준한 곳에 3칸짜리 임시 벽을 8초 세운다" },
    trap: { name: "끈끈이 덫", desc: "밟은 적이 느려진다. 상대에겐 흐릿하게 보인다" },
    smoke: { name: "연막", desc: "6초 동안 잉크 구름 — 안이 보이지 않는다" },
    rally: { name: "집결 깃발", desc: "20초 동안 우리 팀이 깃발에서 부활한다" },
    aegis: { name: "나눔 보호막", desc: "곁의 우리 팀 모두에게 보호막 4초" },
    spray: { name: "회복 스프레이", desc: "곁의 우리 팀 체력 +30" },
    pickup: "획득", // 주웠을 때 뜨는 카드의 딱지
  },

  // 진행자 화면(방장이 "진행자 화면으로 보기"로 들어간 경우 — 교실 큰 화면용. 문제는 보이지 않는다)
  presenter: {
    title: "진행자 화면",
    join: "참여 코드",
    teams: "팀별 진행",
    rooms: "퀴즈 룸",
    open: "열림",
    solving: "{team} 풀이 중",
    entering: "{team} 입장 {in}/{need}",
    empty: "비어 있음",
    noQuiz: "퀴즈 없는 경기입니다",
    people: "인원 관리",
    peopleHint: "자리를 비운 사람은 존 입장 · 정답 인원에서 뺄 수 있어요",
    exclude: "빼기",
    include: "되돌리기",
    excluded: "뺌",
    menu: "메뉴",
    camLabel: "카메라", // 위 띠의 카메라 고르기(화면 읽기 프로그램용)
    camAuto: "자동", // 살아 있는 캐릭터가 모두 들어오게
    camAll: "전체", // 경기장 전체
    followTeam: "{team} 따라가기", // 팀 줄을 누르면
    mapHint: "누르면 그곳을 크게 봐요",
  },

  // 결과 화면에 더한 것(여러 팀 · 퀴즈 표 · CSV)
  resultsMore: {
    solvedUnit: "문제", // 퀴즈: 팀 점수 옆 단위
    finishedAt: "{t}에 완료", // 모든 문제를 푼 시각 — {t} 는 분:초
    lastAt: "마지막 정답 {t}",
    fails: "틀림 {n}",
    pushKing: "밀어내기왕",
    koKing: "KO왕",
    kingValue: "{name} · {n}",
    nobody: "—",
    qTable: "문항별 풀이",
    qHead: "문항",
    qName: "{n}번",
    tries: "{n}번 만에",
    notSolved: "못 풂",
    notTried: "—",
    csv: "결과 CSV 내려받기",
    csvFile: "잉크브로울스-결과-{date}.csv",
    csvLabels: { name: "닉네임", team: "팀", solved: "팀이 맞힌 수", ko: "KO", q: "{n}번", ok: "O", no: "X", tries: "팀별 도전 수", alive: "생존", hp: "남은 체력" },
    rank: "{n}위",
  },
  // 캐릭터 고르기(docs/DESIGN.md §3.9 — 8종 가운데 고른다. 몸 색은 팀 색). 이름은 캐릭터 갈래의 CHARACTERS 가 없을 때 쓰는 기본값
  chars: {
    title: "캐릭터 고르기", // 고르기 창 도장
    group: "캐릭터", // 창 안 첫 묶음(나중에 "무늬" 묶음이 아래에 더해진다)
    skinGroup: "무늬", // (나중에) 무늬 묶음
    mine: "내 캐릭터", // 첫 화면 초상 카드의 작은 글
    change: "바꾸기",
    pickAria: "캐릭터 고르기 — 지금 {name}", // 초상 카드 단추(화면 읽기 프로그램용)
    male: "남자",
    female: "여자",
    // 순서가 곧 번호(서버로 {t:"char", i})다. 윗줄 남자 4 · 아랫줄 여자 4
    list: [
      { key: "beat", name: "비트", gender: "m" }, // 짧은 머리 · 헤드폰
      { key: "spike", name: "삐죽이", gender: "m" }, // 삐죽 머리
      { key: "cap", name: "캡틴", gender: "m" }, // 캡 모자
      { key: "acorn", name: "도토리", gender: "m" }, // 니트 비니
      { key: "twin", name: "방울이", gender: "f" }, // 양 갈래
      { key: "pony", name: "깡충이", gender: "f" }, // 크고 긴 포니테일
      { key: "ribbon", name: "나비", gender: "f" }, // 단발과 큰 리본
      { key: "band", name: "하늘", gender: "f" }, // 긴 머리와 꽃 머리띠
    ],
  },
};
