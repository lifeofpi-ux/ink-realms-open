// 던전의 드론(v16 — docs/DESIGN.md §2.15, 사용자 요청): 네 날개 쿼드콥터. 몸통 · 팔 넷 · 도는 날개 넷 · 아래 팀 색 빛 고리.
// 떠 있는 드론은 제자리에서 둥실, 탄 사람 발밑의 드론은 그 사람을 따라간다(그 자리는 부르는 쪽 — src/dungeonstate.js droneDraws).
// 끝나기 전에는 깜빡이고(blink 1 = 꺼진 순간), 다 되면 떠오르며 줄어 사라진다(fade 0..1).
// 프레임마다: begin() → draw(d) … → end(). 미리 만든 모형 몇 개를 돌려 쓴다(그리기 수는 드론 수만큼 — 레인마다 몇 개뿐).
import * as THREE from "three";
import { TEAMS, PALETTE } from "../shared/constants.js";

const MAX = 12;

export function createDrones() {
  const group = new THREE.Group();
  group.name = "drones";
  const basic = (color, o = {}) => new THREE.MeshBasicMaterial({ color, ...o });
  const M = {
    shell: basic(0x1c1633),
    line: basic(0x07040d, { side: THREE.BackSide }),
    eye: basic(0x7fe9ff),
    blade: basic(0xffffff, { transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }),
  };
  const G = {
    body: new THREE.BoxGeometry(0.9, 0.26, 0.66),
    cap: new THREE.BoxGeometry(0.56, 0.14, 0.44),
    arm: new THREE.BoxGeometry(0.62, 0.09, 0.12),
    hub: new THREE.CylinderGeometry(0.1, 0.12, 0.16, 10),
    blade: new THREE.CylinderGeometry(0.34, 0.34, 0.02, 20),
    guard: new THREE.TorusGeometry(0.4, 0.045, 6, 24),
    ring: new THREE.TorusGeometry(0.55, 0.06, 6, 28),
    eye: new THREE.BoxGeometry(0.06, 0.08, 0.3),
  };
  const outlined = (geo, mat, s = 1.12) => {
    const g = new THREE.Group();
    const m = new THREE.Mesh(geo, mat);
    const o = new THREE.Mesh(geo, M.line);
    o.scale.setScalar(s);
    g.add(o, m);
    return g;
  };

  /** 드론 한 대: 짙은 몸통 + 팀 색 덮개 · 날개 테두리 · 아래 빛 고리(팀 색 재질은 드론마다) */
  function build() {
    const d = new THREE.Group();
    const teamMat = basic(0xa8ff00);
    const ringMat = basic(0xa8ff00, { transparent: true, opacity: 0.9, depthWrite: false });
    d.add(outlined(G.body, M.shell, 1.1));
    const cap = outlined(G.cap, teamMat, 1.14);
    cap.position.y = 0.19;
    d.add(cap);
    const eye = new THREE.Mesh(G.eye, M.eye);
    eye.position.set(0.46, 0.02, 0);
    d.add(eye);
    const rotors = [];
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const ux = Math.cos(a), uz = Math.sin(a);
      const arm = outlined(G.arm, M.shell, 1.18);
      arm.position.set(ux * 0.5, 0.02, uz * 0.5);
      arm.rotation.y = -a;
      d.add(arm);
      const hub = outlined(G.hub, teamMat, 1.15);
      hub.position.set(ux * 0.8, 0.1, uz * 0.8);
      d.add(hub);
      const blade = new THREE.Mesh(G.blade, M.blade);
      blade.position.set(ux * 0.8, 0.2, uz * 0.8);
      d.add(blade);
      const guard = outlined(G.guard, teamMat, 1.25);
      guard.rotation.x = Math.PI / 2;
      guard.position.set(ux * 0.8, 0.2, uz * 0.8);
      d.add(guard);
      rotors.push(blade);
    }
    const ring = new THREE.Mesh(G.ring, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.2;
    d.add(ring);
    d.visible = false;
    group.add(d);
    return { obj: d, rotors, ring, ringMat, teamMat, team: -1 };
  }

  const pool = Array.from({ length: MAX }, build);
  let n = 0;

  return {
    group,
    begin() {
      n = 0;
    },
    /** d = { x, y(몸통 바닥 — 탄 사람의 발 높이), z, t(초 — 날개 · 둥실), blink(1 = 꺼진 순간), team, fade(0..1 — 사라지는 중) } */
    draw(d) {
      if (n >= pool.length) return;
      const D = pool[n++];
      const o = D.obj;
      o.visible = !(d.blink > 0.5);
      o.position.set(d.x, d.y + 0.16, d.z);
      const s = 1.3 * (1 - (d.fade || 0) * 0.75);
      o.scale.setScalar(Math.max(0.05, s));
      o.rotation.z = Math.sin(d.t * 1.7) * 0.05;
      o.rotation.x = Math.cos(d.t * 1.3) * 0.05;
      for (let k = 0; k < D.rotors.length; k++) D.rotors[k].rotation.y = d.t * 38 + k;
      if (d.team !== D.team) {
        D.team = d.team;
        const pi = TEAMS[d.team] ? TEAMS[d.team].color : -1;
        const hex = PALETTE[pi] ? PALETTE[pi].hex : 0xa8ff00;
        D.ringMat.color.setHex(hex);
        D.teamMat.color.setHex(hex);
      }
      D.ringMat.opacity = 0.55 + 0.4 * (0.5 + 0.5 * Math.sin(d.t * 6)) * (1 - (d.fade || 0));
    },
    end() {
      for (let i = n; i < pool.length; i++) pool[i].obj.visible = false;
    },
    clear() {
      n = 0;
      for (const D of pool) D.obj.visible = false;
    },
  };
}
