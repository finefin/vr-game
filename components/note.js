AFRAME.registerComponent('note', {
  schema: {
    lane: { type: 'int', default: 0 },
    color: { type: 'string', default: 'red' },
    time: { type: 'number', default: 0 },
    y: { type: 'number', default: 1.8 },
    dir: { type: 'string', default: '' }
  },

  init: function () {
    this.state = 'active';
    var hex = this.data.color === 'blue' ? '#33ccff' : '#ff3355';
    this.el.setAttribute('material', { shader: 'flat', color: hex });
    this.el.object3D.position.set(
      Game.laneX[this.data.lane],
      this.data.y,
      -Game.SPAWN_Z
    );
    this.el.object3D.quaternion.setFromAxisAngle(
      new THREE.Vector3(-1, 0, 1).normalize(),
      0.9553166
    );

    var d = Game.DIRS[this.data.dir];
    if (d) {
      this.el.object3D.updateMatrixWorld(true);
      var q = new THREE.Quaternion();
      this.el.object3D.getWorldQuaternion(q);
      var front = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      var off = new THREE.Vector3(d.x, d.y, 0).normalize()
        .multiplyScalar(0.16)
        .add(front.multiplyScalar(0.18))
        .applyQuaternion(q.clone().invert());
      var marker = document.createElement('a-plane');
      marker.setAttribute('geometry', { width: 0.13, height: 0.13 });
      marker.setAttribute('material', { shader: 'flat', color: '#ffffff' });
      marker.object3D.position.copy(off);
      this.el.appendChild(marker);
    }
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
