#!/usr/bin/env bash
# Запускает чистый bspwm на новом Xvfb и проверяет геометрию, фокус, клики и fullscreen.
set -euo pipefail
trap 'printf "Ошибка в строке %s\n" "$LINENO" >&2' ERR
cd "$(dirname "$0")/../.."

if [[ ${1:-} != --inside ]]; then
  exec xvfb-run -a -s "-screen 0 ${QUBITE_SMOKE_SIZE:-1440x900}x24" bash "$0" --inside "$@"
fi
shift

test_dir=$(mktemp -d)
cleanup() {
  jobs -pr | xargs -r kill
  rm -rf "$test_dir"
}
trap cleanup EXIT
export LC_ALL=C
export XDG_RUNTIME_DIR="$test_dir"
export BSPWM_SOCKET="$test_dir/bspwm.sock"
app=(python -B experiments/desktop-companion/companion.py)
pet_window() { xdotool search --onlyvisible --name '^Qubite Companion$'; }
wait_for() {
  for ((attempt=0; attempt<60; attempt++)); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep .05
  done
  printf 'Проверка не прошла: %s\n' "$*" >&2
  cat "$test_dir/pet.log" >&2
  return 1
}
gone() { ! pet_window; }
probe_received_click() { grep -q click "$test_dir/probe.log"; }

printf '#!/bin/sh\nbspc monitor -d One Two\n' > "$test_dir/bspwmrc"
chmod +x "$test_dir/bspwmrc"
bspwm -c "$test_dir/bspwmrc" &
two_desktops() { bspc query -D --names | grep -qx Two; }
wait_for two_desktops
picom --config /dev/null --backend xrender > "$test_dir/picom.log" 2>&1 &
compositor=$!
xsetroot -solid '#223143'
python -u - > "$test_dir/probe.log" <<'PY' &
from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QPalette
from PySide6.QtWidgets import QApplication, QWidget

class Probe(QWidget):
    def mousePressEvent(self, event):
        print("click")

app = QApplication([])
window = Probe()
window.setWindowTitle("Companion smoke probe")
palette = window.palette()
palette.setColor(QPalette.ColorRole.Window, QColor("#223143"))
window.setPalette(palette)
window.setAutoFillBackground(True)
window.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
window.show()
app.exec()
PY
wait_for xdotool search --onlyvisible --name '^Companion smoke probe$'
probe=$(xdotool search --onlyvisible --name '^Companion smoke probe$')
focus=$(xdotool getwindowfocus)

cat > "$test_dir/sxhkdrc" <<EOF
super + ctrl + shift + p
    ${app[*]} pass

super + ctrl + shift + h
    ${app[*]} hide
EOF
sxhkd -c "$test_dir/sxhkdrc" > "$test_dir/sxhkd.log" 2>&1 &
"${app[@]}" --theme "${QUBITE_SMOKE_THEME:-dark}" "$@" > "$test_dir/pet.log" 2>&1 &
pet=$!
wait_for pet_window
kill -0 "$compositor"
[[ $(xdotool getwindowfocus) == "$focus" ]]
if bspc query -N | grep -qi "$(printf '0x%08x' "$(pet_window)")"; then
  echo 'Питомец попал в дерево bspwm' >&2
  exit 1
fi
if "${app[@]}" > "$test_dir/duplicate.log" 2>&1; then
  echo 'Запустилась вторая копия' >&2
  exit 1
fi
grep -q 'уже запущен' "$test_dir/duplicate.log"

geometry() {
  xwininfo -id "$(pet_window)" | awk "
    /Absolute upper-left X:/ { x=\$NF }
    /Absolute upper-left Y:/ { y=\$NF }
    /Width:/ { w=\$NF }
    /Height:/ { h=\$NF }
    END { print x, y, w, h }
  "
}
read -r X Y WIDTH HEIGHT < <(geometry)
center_x=$((X + WIDTH / 2))
center_y=$((Y + HEIGHT / 2))
xdotool mousemove "$center_x" "$center_y" click 1 click 3
[[ ! -s "$test_dir/probe.log" ]]
xdotool mousemove "$center_x" "$center_y" mousedown 1 sleep 0.1 mousemove $((center_x - 48)) $((center_y - 24)) sleep 0.15 mouseup 1
read -r moved_x moved_y _ _ < <(geometry)
[[ $moved_x -lt $X && $moved_y -lt $Y ]]

xdotool key super+ctrl+shift+p
sleep .35
xdotool click 1
wait_for probe_received_click
xdotool key super+ctrl+shift+p
sleep .35
xdotool click 1
[[ $(wc -l < "$test_dir/probe.log") == 1 ]]

xdotool key super+ctrl+shift+h
wait_for gone
bspc node "$probe" -t fullscreen
xdotool key super+ctrl+shift+h
sleep .25
gone
bspc desktop Two -f
wait_for pet_window
bspc desktop One -f
wait_for gone
bspc node "$probe" -t tiled
wait_for pet_window
[[ $(xdotool getwindowfocus) == "$focus" ]]

# Снимок искусственного окна служит также проверкой прозрачных углов.
xdotool mousemove 10 10
sleep .2
import -window root "$test_dir/visible.png"
pixel() { magick "$1" -format "%[pixel:p{$2,$3}]" info:; }
corner=$(pixel "$test_dir/visible.png" "$((moved_x + 2))" "$((moved_y + 2))")
behind=$(pixel "$test_dir/visible.png" "$((moved_x - 2))" "$((moved_y + 2))")
[[ $corner == "$behind" ]]
if [[ -n ${QUBITE_SMOKE_SCREENSHOT:-} ]]; then
  cp "$test_dir/visible.png" "$QUBITE_SMOKE_SCREENSHOT"
fi
if [[ ${QUBITE_SMOKE_MEASURE:-0} == 1 ]]; then
  start=$(awk '{print $14+$15}' "/proc/$pet/stat")
  sleep 20
  end=$(awk '{print $14+$15}' "/proc/$pet/stat")
  awk -v cpu="$((end - start))" -v hz="$(getconf CLK_TCK)" '/VmRSS:/ {
    printf "CPU за 20 с: %.2f%% одного ядра, RSS: %s KiB\n", cpu/hz/20*100, $2
  }' "/proc/$pet/status"
  if [[ -n ${QUBITE_SMOKE_SCREENSHOT:-} ]]; then
    import -window root "${QUBITE_SMOKE_SCREENSHOT%.png}-sleep.png"
  fi
  start=$end
  sleep 5
  end=$(awk '{print $14+$15}' "/proc/$pet/stat")
  awk -v cpu="$((end - start))" -v hz="$(getconf CLK_TCK)" 'BEGIN {
    printf "CPU во сне за 5 с: %.2f%% одного ядра\n", cpu/hz/5*100
  }'
fi
"${app[@]}" stop
wait "$pet"
[[ ! -s "$test_dir/pet.log" ]] || { cat "$test_dir/pet.log"; exit 1; }
printf '%s\n' 'X11: одно окно, без захвата фокуса, клик, перетаскивание, пропуск кликов, горячие клавиши, fullscreen и завершение.'
