// nullEngine.js — no audio. The voices panel, density meter, event log and IO monitor still
// fully describe the sonic state, so the whole ruleset is reviewable silently (or headless).
export class NullEngine {
  constructor() { this.name = 'Silencioso'; this._id = 0; }
  async unlock() {}
  isReady() { return true; }
  status() { return 'silent'; }
  noteOn() { return 'n' + (++this._id); }
  noteOff() {}
  swellVoice() {}
  startCrescendo() { return 'n' + (++this._id); }
  resolveToFundamental(id) { return id; }
  cancelCrescendo() {}
  playChord() { return 'n' + (++this._id); }
  stopChord() {}
  finalResolution() {}
  setMasterDynamic() {}
  setMute() {}
  allNotesOff() {}
  reset() {}
}
