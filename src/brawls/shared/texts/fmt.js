// 문구 안의 {이름} 자리를 값으로 채운다.  fmt("{name} 님이 들어왔습니다", { name: "잉크" })
export function fmt(text, vars) {
  return String(text).replace(/\{(\w+)\}/g, (whole, key) => (vars && key in vars ? String(vars[key]) : whole));
}
