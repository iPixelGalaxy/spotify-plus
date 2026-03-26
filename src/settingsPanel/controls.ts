import { defaultSettings, getSetting, setSetting } from "../config";

export function makeGroup(scroll: HTMLElement, name: string) {
  const heading = document.createElement("h3");
  heading.className = "sl-settings-group";
  heading.textContent = name;
  scroll.appendChild(heading);
}

export function makeRow(
  scroll: HTMLElement,
  label: string,
  control: HTMLElement,
  stacked = false
) {
  const row = document.createElement("div");
  row.className = "sl-settings-row";
  if (stacked) {
    row.classList.add("sl-settings-row-stack");
  }

  const labelWrap = document.createElement("span");
  labelWrap.className = "sl-settings-label";
  labelWrap.textContent = label;

  row.appendChild(labelWrap);
  row.appendChild(control);
  scroll.appendChild(row);
}

export function makeButton(label: string, onClick: () => void) {
  const button = document.createElement("button");
  button.className = "sl-btn";
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

export function makeToggle(
  scroll: HTMLElement,
  label: string,
  settingKey: keyof typeof defaultSettings
) {
  const wrapper = document.createElement("div");
  wrapper.className = "sl-toggle";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(getSetting(settingKey));

  const indicator = document.createElement("span");

  input.addEventListener("change", () => {
    setSetting(settingKey, input.checked as never);
  });

  wrapper.addEventListener("click", (event) => {
    event.preventDefault();
    input.checked = !input.checked;
    input.dispatchEvent(new Event("change"));
  });

  wrapper.appendChild(input);
  wrapper.appendChild(indicator);
  makeRow(scroll, label, wrapper);
  return input;
}
