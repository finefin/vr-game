AFRAME.registerComponent('slicer', {
  schema: {
    color: { type: 'string', default: '' }
  },

  init: function () {
    this.prev = new THREE.Vector3();
    this.curr = new THREE.Vector3();
    this.el.object3D.getWorldPosition(this.curr);
    this.prev.copy(this.curr);
  },

  tick: function (t, dt) {
    if (!Game.active) {
      this.prev.copy(this.curr);
      return;
    }
    this.prev.copy(this.curr);
    this.el.object3D.getWorldPosition(this.curr);
    var speed = dt > 0 ? this.curr.distanceTo(this.prev) / (dt / 1000) : 0;
    if (speed > Game.SWING_SPEED) {
      Game.trySlice(this.prev, this.curr, this.data.color);
    }
  }
});
