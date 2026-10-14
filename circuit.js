// Lumped (1-D) circuit solver.
// Maxwell's equations reduce, for a lumped circuit, to:
//   KCL (charge conservation): sum of currents into a node = 0
//   KVL (Faraday, no flux outside inductors): sum of voltages around a loop = 0
//   Element laws:  C dv/dt = i,   L di/dt = v,   v = iR
// Solved with Modified Nodal Analysis and trapezoidal time integration.
(function (root) {
  'use strict';

  const GMIN = 1e-9; // tiny leak to ground so floating nodes stay solvable
  const BRANCH = { dc: 1, ac: 1, ind: 1 }; // elements that add a current unknown

  // comps: [{type, x1,y1,x2,y2, value, amp, freq}] — wires merge nodes.
  function buildNetlist(comps) {
    const parent = new Map();
    const key = (x, y) => x + ',' + y;
    const find = k => {
      if (!parent.has(k)) parent.set(k, k);
      while (parent.get(k) !== k) {
        parent.set(k, parent.get(parent.get(k)));
        k = parent.get(k);
      }
      return k;
    };
    for (const c of comps) { find(key(c.x1, c.y1)); find(key(c.x2, c.y2)); }
    for (const c of comps) {
      if (c.type === 'wire') parent.set(find(key(c.x1, c.y1)), find(key(c.x2, c.y2)));
    }
    const ids = new Map();
    const nodeOf = (x, y) => {
      const r = find(key(x, y));
      if (!ids.has(r)) ids.set(r, ids.size);
      return ids.get(r);
    };
    const elems = [];
    for (const c of comps) {
      const a = nodeOf(c.x1, c.y1), b = nodeOf(c.x2, c.y2);
      if (c.type !== 'wire') elems.push({ c, a, b, v: 0, i: 0 });
    }
    const src = elems.find(e => e.c.type === 'dc' || e.c.type === 'ac');
    return { elems, nodeOf, count: ids.size, ground: src ? src.b : 0 };
  }

  // Gauss-Jordan with partial pivoting on an augmented matrix. Returns {x, singular}.
  function solve(A, N) {
    const x = new Float64Array(N);
    let singular = false, r = 0;
    const pivCol = [];
    for (let col = 0; col < N && r < N; col++) {
      let p = r;
      for (let k = r + 1; k < N; k++) if (Math.abs(A[k][col]) > Math.abs(A[p][col])) p = k;
      if (Math.abs(A[p][col]) < 1e-14) { singular = true; continue; }
      [A[r], A[p]] = [A[p], A[r]];
      const piv = A[r][col];
      for (let j = col; j <= N; j++) A[r][j] /= piv;
      for (let k = 0; k < N; k++) {
        if (k === r) continue;
        const f = A[k][col];
        if (f !== 0) for (let j = col; j <= N; j++) A[k][j] -= f * A[r][j];
      }
      pivCol[r] = col;
      r++;
    }
    for (let k = 0; k < r; k++) x[pivCol[k]] = A[k][N];
    return { x, singular: singular || r < N };
  }

  class Sim {
    constructor(comps) {
      Object.assign(this, buildNetlist(comps));
      this.nv = new Float64Array(this.count); // node voltages
      this.t = 0;
      this.singular = false;
    }

    // Advance one time step h. Element values are read live from the comps.
    step(h) {
      const { elems, count, ground } = this;
      const idx = [];
      let N = 0;
      for (let n = 0; n < count; n++) idx.push(n === ground ? -1 : N++);
      for (const e of elems) if (BRANCH[e.c.type]) e.j = N++;
      const A = Array.from({ length: N }, () => new Float64Array(N + 1));
      const add = (r, c, v) => { if (r >= 0 && c >= 0) A[r][c] += v; };
      const rhs = (r, v) => { if (r >= 0) A[r][N] += v; };
      const conductance = (a, b, g) => { add(a, a, g); add(b, b, g); add(a, b, -g); add(b, a, -g); };

      for (let n = 0; n < count; n++) add(idx[n], idx[n], GMIN);
      for (const e of elems) {
        const a = idx[e.a], b = idx[e.b], c = e.c;
        if (c.type === 'res') {
          conductance(a, b, 1 / c.value);
        } else if (c.type === 'cap') {
          const g = 2 * c.value / h;
          e.ieq = g * e.v + e.i; // history current
          conductance(a, b, g);
          rhs(a, e.ieq); rhs(b, -e.ieq);
        } else {
          add(a, e.j, 1); add(b, e.j, -1);       // branch current leaves a, enters b
          add(e.j, a, 1); add(e.j, b, -1);       // va - vb = ...
          if (c.type === 'ind') {
            const k = 2 * c.value / h;
            add(e.j, e.j, -k);
            rhs(e.j, -k * e.i - e.v);
          } else {
            const vs = c.type === 'dc' ? c.value : c.amp * Math.sin(2 * Math.PI * c.freq * (this.t + h));
            rhs(e.j, vs);
          }
        }
      }

      const { x, singular } = solve(A, N);
      this.singular = singular;
      for (let n = 0; n < count; n++) this.nv[n] = idx[n] < 0 ? 0 : x[idx[n]];
      for (const e of elems) {
        const v = this.nv[e.a] - this.nv[e.b];
        if (e.c.type === 'res') e.i = v / e.c.value;
        else if (e.c.type === 'cap') e.i = 2 * e.c.value / h * v - e.ieq;
        else e.i = x[e.j];
        e.v = v;
      }
      this.t += h;
    }
  }

  const api = { Sim, buildNetlist };
  if (typeof module !== 'undefined') module.exports = api;
  else root.Circuit = api;
})(this);
