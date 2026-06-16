const fs = require('fs');
let content = fs.readFileSync('src/components/CesiumMap.vue', 'utf8');

// Optimization 1: Remove entity.show=false when time < pts[0]
content = content.replace(
  /if \(time < pts\[0\]\.timestamp\) \{\s+if \(entities\.entity\) entities\.entity\.show = false\s+if \(entities\.trailLine\) \{ removeTrailLine\(entities\.trailLine\); entities\.trailLine = undefined \}\s+continue\s+\}/,
  `if (time < pts[0].timestamp) {
      if (entities.trailLine) { removeTrailLine(entities.trailLine); entities.trailLine = undefined }
      continue
    }`
);
console.log('opt1 done');

// Optimization 1+2: Replace trail build with lo-guarded version, remove entity.show=false
const oldTrail = `    // Build progressive trail: points up to lo + interpolated current
    const trailPts: number[] = []
    for (let i = 0; i <= lo; i++) {
      trailPts.push(pts[i].longitude, pts[i].latitude, FLAT_ALTITUDE)
    }
    const lastPast = pts[lo]
    if (Math.abs(cpLat - lastPast.latitude) > 1e-7 || Math.abs(cpLng - lastPast.longitude) > 1e-7) {
      trailPts.push(cpLng, cpLat, FLAT_ALTITUDE)
    }
    const trailPositions = Cesium.Cartesian3.fromDegreesArrayHeights(trailPts)

    // Hide full entity line, show trail in PolylineCollection
    if (entities.entity) entities.entity.show = false

    if (entities.trailLine) {
      entities.trailLine.positions = trailPositions
      entities.trailLine.show = trailPositions.length >= 2 && vis
    } else if (trailPositions.length >= 2) {`;

const newTrail = `    // Build progressive trail ONLY when lo advances
    if (lo !== entities.lastTrailLo) {
      entities.lastTrailLo = lo

      const trailPts: number[] = []
      for (let i = 0; i <= lo; i++) {
        trailPts.push(pts[i].longitude, pts[i].latitude, FLAT_ALTITUDE)
      }
      const lastPast = pts[lo]
      if (Math.abs(cpLat - lastPast.latitude) > 1e-7 || Math.abs(cpLng - lastPast.longitude) > 1e-7) {
        trailPts.push(cpLng, cpLat, FLAT_ALTITUDE)
      }
      const trailPositions = Cesium.Cartesian3.fromDegreesArrayHeights(trailPts)

      if (entities.trailLine) {
        entities.trailLine.positions = trailPositions
        entities.trailLine.show = trailPositions.length >= 2 && vis
      } else if (trailPositions.length >= 2) {`;

if (content.includes(oldTrail)) {
  content = content.replace(oldTrail, newTrail);
  console.log('opt2 done');
} else {
  console.log('ERROR: old trail section not found');
  process.exit(1);
}

// Fix the closing braces for the new if-block (need one more })
// The old code had: } (closing the else-if for trailLine)
// The new code has: } (closing the else-if) + } (closing the if (lo !== lastTrailLo) block)
// Find and fix: the trailLine.add closing section needs to close the outer if too
const oldTrailAddClose = `      const color = getLineColor(track.source)
      const isSel = tKey === props.selectedId
      const isRaw = track.source === 'radar_raw'
      entities.trailLine = trackLines!.add({
        id: \`trail::\${tKey}\`,
        show: vis,
        positions: trailPositions,
        width: isSel ? SELECTED_WIDTH : baseWidth(track.source),
        material: Cesium.Material.fromType('Color', {
          color: color.withAlpha(isSel ? SELECTED_ALPHA : (isRaw ? RAW_ALPHA : NORMAL_ALPHA)),
        }),
      })
    }`;

const newTrailAddClose = `        const color = getLineColor(track.source)
        const isSel = tKey === props.selectedId
        const isRaw = track.source === 'radar_raw'
        entities.trailLine = trackLines!.add({
          id: \`trail::\${tKey}\`,
          show: vis,
          positions: trailPositions,
          width: isSel ? SELECTED_WIDTH : baseWidth(track.source),
          material: Cesium.Material.fromType('Color', {
            color: color.withAlpha(isSel ? SELECTED_ALPHA : (isRaw ? RAW_ALPHA : NORMAL_ALPHA)),
          }),
        })
      }
    }`;

if (content.includes(oldTrailAddClose)) {
  content = content.replace(oldTrailAddClose, newTrailAddClose);
  console.log('opt2 close fixed');
} else {
  console.log('ERROR: trail add close not found');
  process.exit(1);
}

// Optimization 3: Replace syncEntities with trackLines recreation
const oldStopEnd = '      if (previousSelectedId) applyHighlight(previousSelectedId)\n      // Full entity rebuild via suspendEvents/resumeEvents batch — clears any stale\n      // Cesium internal state accumulated during replay (same path as filtering)\n      syncEntities(props.tracks)\n      viewer?.scene.requestRender()';

const newStopEnd = '      if (previousSelectedId) applyHighlight(previousSelectedId)\n      // Rebuild trackLines to shrink VBO inflated by 2900 trail lines during replay\n      if (trackLines && viewer) {\n        viewer.scene.primitives.remove(trackLines)\n        if (!trackLines.isDestroyed()) trackLines.destroy()\n        trackLines = viewer.scene.primitives.add(new Cesium.PolylineCollection()) as unknown as Cesium.PolylineCollection\n      }\n      viewer?.scene.requestRender()';

if (content.includes(oldStopEnd)) {
  content = content.replace(oldStopEnd, newStopEnd);
  console.log('opt3 done');
} else {
  // Try without comment
  const altOld = '      if (previousSelectedId) applyHighlight(previousSelectedId)\n      syncEntities(props.tracks)\n      viewer?.scene.requestRender()';
  if (content.includes(altOld)) {
    content = content.replace(altOld, newStopEnd);
    console.log('opt3 done (alt)');
  } else {
    console.log('ERROR: stop end not found');
    process.exit(1);
  }
}

fs.writeFileSync('src/components/CesiumMap.vue', content);
console.log('all optimizations applied');
