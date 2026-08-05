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
