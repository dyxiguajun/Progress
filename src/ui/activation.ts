export function isCardBodyActivationTarget(target:EventTarget|null) {
  return target instanceof Element&&!target.closest('button,a,input,select,textarea,summary,[contenteditable="true"],[data-resize],[data-card-control]');
}
