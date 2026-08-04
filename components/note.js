AFRAME.registerComponent('note', {
  schema: {
    lane: { type: 'int', default: 0 },
    color: { type: 'string', default: 'red' },
    time: { type: 'number', default: 0 },
    y: { type: 'number', default: 1.8 }
  },

  init: function () {
    this.state = 'active';
    var hex = this.data.color === 'blue' ? '#33ccff' : '#ff3355';
    this.el.setAttribute('material', { shader: 'flat', color: hex, transparent: true, opacity: 0 });
    this.el.object3D.scale.set(0.1, 0.1, 0.1);
    this.el.setAttribute('animation__fade', {
      property: 'material.opacity',
      to: 1,
      dur: 300,
      easing: 'easeOutCubic'
    });
    this.el.setAttribute('animation__scale', {
      property: 'scale',
      to: '1 1 1',
      dur: 300,
      easing: 'easeOutBack'
    });

    var mesh = this.el.getObject3D('mesh');
    if (mesh) {
      var edges = new THREE.EdgesGeometry(mesh.geometry);
      var line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff }));
      mesh.add(line);
    }

    this.el.object3D.position.set(
      Game.laneX[this.data.lane],
      this.data.y,
      -Game.SPAWN_Z
    );
    this.el.object3D.quaternion.setFromAxisAngle(
      new THREE.Vector3(-1, 0, 1).normalize(),
      0.9553166
    );
  },

  tick: function (time, timeDelta) {
    if (Game.active && this.state === 'active') {
      this.el.object3D.rotateY((timeDelta || 16) / 1000 * 1.8);
    }
    if (!Game.active || this.state !== 'active') return;
    this.el.object3D.position.z = Game.SPEED * (Game._at - this.data.time);
    if (this.el.object3D.position.z > Game.PASS_Z) {
      this.state = 'missed';
      Game.miss(this.el);
    }
  }
});
