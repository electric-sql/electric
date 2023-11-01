import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { Readline } from "xterm-readline";

import "xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api";
import { Event, listen } from "@tauri-apps/api/event";

const terminalElement = document.getElementById("terminal") as HTMLElement;

const fitAddon = new FitAddon();
const rl = new Readline();
const term = new Terminal({
  // fontFamily: "Jetbrains Mono",
  // theme: {
    // background: "rgb(47, 47, 47)",
  // }
  theme: {
    background: "#191A19",
    foreground: "#F5F2E7",
  },
  cursorBlink: true,
  cursorStyle: "block"
  });
term.loadAddon(fitAddon);
term.loadAddon(rl);
term.open(terminalElement);

// Make the terminal fit all the window size
function fitTerminal() {
  fitAddon.fit();
  void invoke<string>("async_resize_pty", {
    rows: term.rows,
    cols: term.cols,
  });
}

// Write data from pty into the terminal
function writeToTerminal(ev: Event<string>) {
  term.write(ev.payload)
}

// Write data from the terminal to the pty
// function writeToPty(data: string) {
//   void invoke("async_write_to_pty", {
//     data,
//   });
// }

// Write data from the terminal to the pty
function writeDataToPostgres(query: string) {
  void invoke("send_recv_postgres_terminal", {
    query,
  });
}

// term.onData(writeToPty);
// term.onData(writeDataToPostgres);
addEventListener("resize", fitTerminal);
listen("data", writeToTerminal)
fitTerminal();

rl.setCheckHandler((text) => {
  return !text.trimEnd().endsWith("&&");
});

function readLine() {
  rl.read("postgres>")
    .then(processLine);
}

async function processLine(data: string) {
  invoke("send_recv_postgres_terminal", { data }).then((message) => rl.println(String(message)));
  setTimeout(readLine);
}

readLine();
