AFRAME.registerComponent('explosion', {
  schema: {
    color: { type: 'color', default: '#ff3355' },
    count: { type: 'int', default: 24 },
    life: { type: 'number', default: 0.5 }
  },

  init: function () {
    this.built = false;
    this.alive = this.data.life;
  },

  build: function () {
    var scene = this.el.sceneEl.object3D;
    var pos = new THREE.Vector3();
    this.el.object3D.getWorldPosition(pos);
    var color = new THREE.Color(this.data.color);
    var group = new THREE.Group();
    this.group = group;
    this.particles = [];
    for (var i = 0; i < this.data.count; i++) {
      var geo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
      var mat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 1 });
      var mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      this.particles.push({
        mesh: mesh,
        v: new THREE.Vector3(
          (Math.random() - 0.5) * 3.5,
          Math.random() * 2 + 0.5,
          (Math.random() - 0.5) * 3.5
        ),
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 12,
          (Math.random() - 0.5) * 12,
          (Math.random() - 0.5) * 12
        )
      });
      group.add(mesh);
    }
    scene.add(group);
  },

  tick: function (time, timeDelta) {
    if (!this.built) {
      this.build();
      this.built = true;
    }
    var d = (timeDelta || 16) / 1000;
    this.alive -= d;
    var f = Math.max(0, this.alive / this.data.life);
    for (var i = 0; i < this.particles.length; i++) {
      var p = this.particles[i];
      p.v.y -= 9.8 * d;
      p.mesh.position.addScaledVector(p.v, d);
      p.mesh.rotation.x += p.spin.x * d;
      p.mesh.rotation.y += p.spin.y * d;
      p.mesh.rotation.z += p.spin.z * d;
      p.mesh.material.opacity = f;
    }
    if (this.alive <= 0) {
      if (this.group && this.group.parent) this.group.parent.remove(this.group);
      this.el.remove();
    }
  }
});

// Reusable scale-punch for HUD text. Call .punch(strength) to kick it off —
// positive grows and settles back (a hit), negative dips and recovers (a
// break). Reads its resting scale from whatever the entity's `scale`
// attribute already is, so score/combo can share it despite different sizes.
AFRAME.registerComponent('hud-punch', {
  init: function () {
    this.age = Infinity;
    this.strength = 0;
    this.base = this.el.object3D.scale.x || 1;
  },

  punch: function (strength) {
    this.age = 0;
    this.strength = strength;
  },

  tick: function (time, timeDelta) {
    if (this.age > 0.3) return;
    this.age += (timeDelta || 16) / 1000;
    var f = Math.max(0, 1 - this.age / 0.3);
    var s = this.base * (1 + this.strength * f * f);
    this.el.object3D.scale.set(s, s, 1);
  }
});
