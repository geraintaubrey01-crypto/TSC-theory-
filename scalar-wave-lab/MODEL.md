# Scalar Wave Lab: numerical model

This folder is a dependency-free browser application. Open `index.html` in a current browser with WebGL2 support. All simulation and rendering work is performed locally; the browser needs no network access.

## What is simulated

The app evolves a real-valued scalar field \(u_{i,j}^{n}\) on a square, two-dimensional grid. A five-point finite-difference stencil approximates the spatial Laplacian:

\[
\nabla^2 u_{i,j} \approx u_{i+1,j}+u_{i-1,j}+u_{i,j+1}+u_{i,j-1}-4u_{i,j}.
\]

The update is a damped, explicit wave equation:

\[
u^{n+1}_{i,j}=2u^n_{i,j}-u^{n-1}_{i,j}
+c^2\nabla^2u^n_{i,j}
-\gamma(u^n_{i,j}-u^{n-1}_{i,j})+S^n_{i,j}.
\]

Here \(c\) is the displayed wave-speed control, \(\gamma\) is damping, and \(S\) is a short Gaussian impulse applied when the user clicks or drags. The two most recent field values occupy the red and green channels of a floating-point GPU texture. Each simulation step reads one texture and writes the other (ping-pong rendering), avoiding read/write feedback on the same texture.

The speed range is bounded to keep the explicit two-dimensional update below its approximate Courant-Friedrichs-Lewy stability limit \(c \le 1/\sqrt{2}\). The solver uses a fixed grid and one step per animation frame, so simulation time advances with display refresh rate. Damping reduces persistent oscillations; the app is an instructional visualization, not a calibrated physical solver.

## Topologies and edge rules

These are boundary identifications applied by the GPU stencil, not geometrically embedded 3D surfaces:

| Choice | Grid-edge rule |
| --- | --- |
| Plane patch | Values along the rectangular grid boundary are fixed to zero (Dirichlet boundary). |
| Torus | Wrap both grid axes periodically. |
| Möbius strip | Crossing the x seam wraps to the opposite side and reverses the y index; the two y edges remain zero-boundary edges. |
| Klein bottle | Crossing the x seam wraps and reverses y; the y axis also wraps periodically. |

The names describe the discrete domain identifications used by this toy solver. They do not model embedding geometry, curvature, or spacetime.

### Topology roadmap

The first four entries in the table above are implemented. The following are reasonable extensions, but each requires its own mapping and verification rather than just a new UI label:

| Candidate | Possible discrete treatment |
| --- | --- |
| Infinite plane / larger finite patch | Increase grid size or add a nonreflecting absorbing layer around a finite patch. |
| Cylinder | Periodically identify one axis and keep fixed, reflecting, or absorbing boundaries on the other. |
| Sphere | Use a latitude-longitude grid with pole treatment, or a more uniform triangulated mesh to avoid coordinate singularities. |
| Projective plane | Identify opposite edges with a reversal in both coordinates; define corner consistency explicitly. |
| Higher-genus orientable surface | Pair edges of a polygonal domain according to a verified surface identification. |
| Periodic lattice / cell | Use periodic boundaries, then vary the medium or source within a repeating unit cell. |
| Graph or irregular mesh | Replace the rectangular stencil with a graph/mesh Laplacian and a compatible GPU data layout. |

These are mathematical domains for the scalar PDE. A topology selection alone does not represent a wormhole or imply a physical connection through spacetime.

## GPU pipeline

1. WebGL2 checks for floating-point framebuffer support and allocates two 256 × 256 RGBA16F textures.
2. A fragment shader fetches each cell and its four neighbors with `texelFetch`, remapping neighbor indices at topology seams.
3. The shader computes the next wave state into the other texture. A Gaussian source adds energy at the selected pointer location.
4. A display shader maps positive and negative amplitudes to separate colors and renders the texture to the canvas.
5. The textures exchange read/write roles for the next frame.

## Limitations and extensions

The field has no physical units, source mass, gravitational coupling, or experimentally fitted parameters. The displayed colors are a signed-amplitude visualization, not energy density. This implementation does not validate Tensional Scalar Cosmology, general relativity modifications, antigravity, wormholes, quantum entanglement, or propulsion claims.

### Extension catalog

- **Sources:** configurable Gaussian widths, continuous oscillators, wave packets, multiple moving emitters, source phase, and timed pulse sequences.
- **Media and equations:** spatially varying wave speed, anisotropic propagation, nonlinear terms, reaction/diffusion coupling, and explicitly documented external potentials.
- **Numerics:** alternative higher-order or more isotropic stencils, a spectral/FFT solver for periodic domains, adaptive stepping, and grid-resolution controls.
- **Boundaries:** absorbing layers, reflective boundaries, mixed boundary conditions, and validated edge mappings for additional domains.
- **Diagnostics:** discrete energy estimates, stability/CFL warnings, field extrema, convergence checks, and comparison against a small CPU reference implementation.
- **Visualization:** 3D height surface, contour and phase views, vector overlays, historical trails, adjustable color ranges, and probe plots.
- **Reproducibility:** snapshot/CSV export, parameter metadata, deterministic seed handling for stochastic forcing, and replayable source events.
- **Quality and accessibility:** automated shader/browser smoke tests, performance controls, keyboard-operable controls, and reduced-motion behavior.

Each extension should state its discretization, physical units (if any), numerical stability assumptions, and validation strategy.
