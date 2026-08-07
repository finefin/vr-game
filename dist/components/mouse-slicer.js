// Desktop testing aid — no VR headset needed. Left click "swings" the red
// saber, right click the blue one, at whatever the mouse currently points to.
// No swing speed or blade model: holding a button and hovering a note is
// enough to slice it, since the timing grade still comes from Game._at vs.
// the note's real time either way. Low-effort by design — this is for
// checking a beatmap plays right, not for a polished desktop mode.
(function () {
  var HIT_PLANE = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // world z = 0

  // The VR camera sits at world z=0 — same as HIT_PLANE, its own gameplay
  // position — so a desktop ray from it starts already on the plane and the
  // "hit" collapses to the camera's own position, not where the mouse points.
  // Pulling the desktop camera back gives the ray real distance to travel.
  // Only applied on desktop; a real headset keeps z=0 and full head tracking.
  var DESKTOP_CAM_Z = 4;

  AFRAME.registerComponent('mouse-slicer', {
    init: function () {
      this.raycaster = new THREE.Raycaster();
      this.ndc = new THREE.Vector2(0, 0);
      this.hit = new THREE.Vector3();
      this.active = { red: false, blue: false };

      var self = this;
      var scene = this.el;
      var cam = document.getElementById('cam');

      // Desktop: pull the camera back and turn off look-controls' mouse-drag,
      // so a click-drag to slice can't also spin the view. VR: leave both
      // exactly as the headset expects.
      function setDesktopMode(on) {
        if (!cam) return;
        cam.object3D.position.z = on ? DESKTOP_CAM_Z : 0;
        cam.setAttribute('look-controls', 'enabled', !on);
      }

      scene.addEventListener('loaded', function () { setDesktopMode(!scene.is('vr-mode')); });
      scene.addEventListener('enter-vr', function () { setDesktopMode(false); });
      scene.addEventListener('exit-vr', function () { setDesktopMode(true); });

      window.addEventListener('mousemove', function (e) {
        self.ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
        self.ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
      });
      window.addEventListener('mousedown', function (e) {
        if (e.button === 0) self.active.red = true;
        else if (e.button === 2) self.active.blue = true;
      });
      window.addEventListener('mouseup', function (e) {
        if (e.button === 0) self.active.red = false;
        else if (e.button === 2) self.active.blue = false;
      });
      // Right click is the blue saber, not a context menu.
      window.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    },

    tick: function () {
      if (!this.active.red && !this.active.blue) return;
      if (this.el.sceneEl.is('vr-mode')) return;
      var camera = this.el.sceneEl.camera;
      if (!camera || !window.Game) return;

      this.raycaster.setFromCamera(this.ndc, camera);
      if (!this.raycaster.ray.intersectPlane(HIT_PLANE, this.hit)) return;

      if (this.active.red) window.Game.trySlice(this.hit, this.hit, 'red');
      if (this.active.blue) window.Game.trySlice(this.hit, this.hit, 'blue');
    }
  });
})();
