AFRAME.registerComponent('note', {
  schema: {
    lane: { type: 'int', default: 0 },
    color: { type: 'string', default: 'red' },
    time: { type: 'number', default: 0 }
  },

  init: function () {
    this.state = 'active';
    var hex = this.data.color === 'blue' ? '#33ccff' : '#ff3355';
    this.el.setAttribute('material', { shader: 'flat', color: hex });
    this.el.object3D.position.set(
      Game.laneX[this.data.lane],
      Game.HEIGHT,
      -Game.SPAWN_Z
    );
  },

  tick: function () {
    if (!Game.active || this.state !== 'active') return;
    this.el.object3D.position.z = Game.SPEED * (Game._at - this.data.time);
    if (this.el.object3D.position.z > Game.PASS_Z) {
      this.state = 'missed';
      Game.miss(this.el);
    }
  }
});
