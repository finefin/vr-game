// A missed note falls and tumbles for MISS_FADE_DUR seconds before removing
// itself, instead of vanishing — same mesh, no extra geometry, just an
// animated exit so a miss reads as a miss rather than a note blinking out.
var MISS_FADE_DUR = 0.35;
var MISS_GRAVITY = 9.8;

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
      this.edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 });
      var line = new THREE.LineSegments(edges, this.edgeMat);
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
    var dt = (timeDelta || 16) / 1000;

    if (this.state === 'missed') {
      // Runs to completion regardless of Game.active — a self-contained
      // cleanup animation, not gameplay — so a note that starts falling right
      // as the song ends doesn't freeze mid-fade behind the results screen.
      this.missAge += dt;
      this.fallVel -= MISS_GRAVITY * dt;
      this.el.object3D.position.y += this.fallVel * dt;
      this.el.object3D.rotateX(dt * 3.2);
      this.el.object3D.rotateZ(dt * 2.4);
      var f = Math.max(0, 1 - this.missAge / MISS_FADE_DUR);
      this.el.setAttribute('material', 'opacity', f);
      if (this.edgeMat) this.edgeMat.opacity = f;
      if (this.missAge >= MISS_FADE_DUR) this.el.remove();
      return;
    }

    if (Game.active) this.el.object3D.rotateY(dt * 1.8);
    if (!Game.active || this.state !== 'active') return;
    this.el.object3D.position.z = Game.SPEED * (Game._at - this.data.time);
    if (this.el.object3D.position.z > Game.PASS_Z) {
      this.state = 'missed';
      this.missAge = 0;
      this.fallVel = 0;
      Game.miss(this.el);
    }
  }
});
