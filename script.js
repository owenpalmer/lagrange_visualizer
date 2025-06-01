// Configuration
const X_MIN = -10, X_MAX = 10;
const Y_MIN = -10, Y_MAX = 10;
const CANVAS_SIZE = 600;
const POINT_RADIUS = 5;
const AXIS_COLOR = "#444";
const POLY_COLOR = "#2980b9";
const POLY_LINEWIDTH = 2.5;
const HOVER_POINT_COLOR = "#555";
const SAMPLE_STEPS = 500;

// State
let points = [];          // Array of { x, y }
let hoverPoint = null;    // { x, y } or null
let displayNumeric = false;
let showBasisCurves = true; // New state for basis curves visibility

// DOM refs
const canvas = document.getElementById("plotCanvas");
const ctx = canvas.getContext("2d");
const toggleNumeric = document.getElementById("toggleNumeric");
const toggleBasisCurves = document.getElementById("toggleBasisCurves");
const pointsTableBody = document.querySelector("#pointsTable tbody");
const mathDisplay = document.getElementById("mathDisplay");

// Coordinate helpers
function canvasToCoord(px, py) {
    const x = X_MIN + (px / CANVAS_SIZE) * (X_MAX - X_MIN);
    const y = Y_MAX - (py / CANVAS_SIZE) * (Y_MAX - Y_MIN);
    return { x, y };
}
function coordToCanvas(x, y) {
    const px = ((x - X_MIN) / (X_MAX - X_MIN)) * CANVAS_SIZE;
    const py = ((Y_MAX - y) / (Y_MAX - Y_MIN)) * CANVAS_SIZE;
    return { px, py };
}

// Generate distinct HSL color for basis index
function basisColor(idx, total) {
    const hue = (idx / total) * 360;
    return `hsl(${hue}, 70%, 50%)`;
}

// Convert HSL color to RGB values for CSS
function hslToRgb(hslString) {
    // Parse HSL string like "hsl(120, 70%, 50%)"
    const match = hslString.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
    if (!match) return "rgb(0, 0, 0)";
    
    const h = parseInt(match[1]) / 360;
    const s = parseInt(match[2]) / 100;
    const l = parseInt(match[3]) / 100;
    
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
    };
    
    let r, g, b;
    if (s === 0) {
        r = g = b = l; // achromatic
    } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    
    return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

// Create or update CSS styles for basis term backgrounds
function updateBasisStyles() {
    // Remove existing basis styles
    let existingStyle = document.getElementById('basis-term-styles');
    if (existingStyle) {
        existingStyle.remove();
    }
    
    if (!showBasisCurves || points.length === 0) return;
    
    // Create new style element
    const style = document.createElement('style');
    style.id = 'basis-term-styles';
    
    let css = '';
    for (let j = 0; j < points.length; j++) {
        const color = hslToRgb(basisColor(j, points.length));
        css += `.basis-term-${j} { background-color: ${color}; padding: 2px 4px; border-radius: 3px; }\n`;
    }
    
    style.textContent = css;
    document.head.appendChild(style);
}

// Compute ℓ_j(x) * y_j at xVal, along with symbolic denominator/numerator lists
function lagrangeBasisTerm(allPoints, j, xVal) {
    const n = allPoints.length;
    let numeratorVal = 1;
    let denomVal = 1;
    let numeratorSyms = [];
    let denomSyms = [];
    for (let m = 0; m < n; m++) {
        if (m === j) continue;
        const xm = allPoints[m].x;
        const xj = allPoints[j].x;
        // numeric factors
        numeratorVal *= (xVal - xm);
        denomVal *= (xj - xm);
        // symbolic pieces
        numeratorSyms.push(`(x - x_{${m + 1}})`);
        denomSyms.push(`(x_{${j + 1}} - x_{${m + 1}})`);
    }
    const yj = allPoints[j].y;
    const value = yj * (numeratorVal / denomVal);
    return {
        value,
        numeratorSyms,
        denomSyms,
        yj
    };
}

// Evaluate full polynomial at xVal via basis terms
function evaluatePolynomial(allPoints, xVal) {
    let sum = 0;
    for (let j = 0; j < allPoints.length; j++) {
        const { value } = lagrangeBasisTerm(allPoints, j, xVal);
        sum += value;
    }
    return sum;
}

// Draw axes
function drawAxes() {
    ctx.strokeStyle = AXIS_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const y0 = coordToCanvas(0, 0).py;
    ctx.moveTo(0, y0);
    ctx.lineTo(CANVAS_SIZE, y0);
    const x0 = coordToCanvas(0, 0).px;
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0, CANVAS_SIZE);
    ctx.stroke();

    const tickLen = 5;
    ctx.beginPath();
    ctx.fillStyle = AXIS_COLOR;
    ctx.font = "12px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let xi = Math.ceil(X_MIN); xi <= Math.floor(X_MAX); xi++) {
        const { px } = coordToCanvas(xi, 0);
        ctx.moveTo(px, y0 - tickLen);
        ctx.lineTo(px, y0 + tickLen);
        if (xi !== 0) ctx.fillText(xi, px, y0 + tickLen + 2);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let yi = Math.ceil(Y_MIN); yi <= Math.floor(Y_MAX); yi++) {
        const { py } = coordToCanvas(0, yi);
        ctx.moveTo(x0 - tickLen, py);
        ctx.lineTo(x0 + tickLen, py);
        if (yi !== 0) ctx.fillText(yi, x0 - tickLen - 4, py);
    }
    ctx.stroke();
}

// Draw individual basis curves ℓ_j(x)*y_j
function drawBasisCurves(allPoints) {
    if (!showBasisCurves) return; // Skip drawing if disabled
    
    const n = allPoints.length;
    if (n === 0) return;
    for (let j = 0; j < n; j++) {
        ctx.strokeStyle = basisColor(j, n);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        let first = true;
        for (let i = 0; i <= SAMPLE_STEPS; i++) {
            const t = i / SAMPLE_STEPS;
            const x = X_MIN + t * (X_MAX - X_MIN);
            const { value } = lagrangeBasisTerm(allPoints, j, x);
            if (!isFinite(value)) { first = true; continue; }
            const { px, py } = coordToCanvas(x, value);
            if (first) { ctx.moveTo(px, py); first = false; }
            else { ctx.lineTo(px, py); }
        }
        ctx.stroke();
    }
}

// Draw full polynomial as a bold curve
function drawFullPolynomial(allPoints) {
    if (allPoints.length < 2) return;
    ctx.strokeStyle = POLY_COLOR;
    ctx.lineWidth = POLY_LINEWIDTH;
    ctx.beginPath();
    let first = true;
    for (let i = 0; i <= SAMPLE_STEPS; i++) {
        const t = i / SAMPLE_STEPS;
        const x = X_MIN + t * (X_MAX - X_MIN);
        const y = evaluatePolynomial(allPoints, x);
        if (!isFinite(y)) { first = true; continue; }
        const { px, py } = coordToCanvas(x, y);
        if (first) { ctx.moveTo(px, py); first = false; }
        else { ctx.lineTo(px, py); }
    }
    ctx.stroke();
}

// Draw points and hover point
function drawPoints() {
    // Permanent points in red
    points.forEach(p => {
        const { px, py } = coordToCanvas(p.x, p.y);
        ctx.beginPath();
        ctx.fillStyle = "#e74c3c";
        ctx.arc(px, py, POINT_RADIUS, 0, 2 * Math.PI);
        ctx.fill();
    });
    // Hover point as hollow circle
    if (hoverPoint) {
        const { px, py } = coordToCanvas(hoverPoint.x, hoverPoint.y);
        ctx.beginPath();
        ctx.strokeStyle = HOVER_POINT_COLOR;
        ctx.lineWidth = 1.5;
        ctx.arc(px, py, POINT_RADIUS, 0, 2 * Math.PI);
        ctx.stroke();
    }
}

// Update table of points
function updateTable() {
    pointsTableBody.innerHTML = '';
    points.forEach((p, i) => {
        const row = document.createElement('tr');
        const idxCell = document.createElement('td');
        const xCell = document.createElement('td');
        const yCell = document.createElement('td');
        idxCell.textContent = i + 1;
        xCell.textContent = p.x.toFixed(3);
        yCell.textContent = p.y.toFixed(3);
        
        // Make the x_i cell hoverable
        xCell.classList.add('hoverable-cell');
        xCell.dataset.pointIndex = i;
        
        // Make the f(xi) cell hoverable
        yCell.classList.add('hoverable-cell');
        yCell.dataset.pointIndex = i;
        
        // Add hover event listeners for x_i values
        xCell.addEventListener('mouseenter', () => highlightXiElements(i));
        xCell.addEventListener('mouseleave', () => clearXiHighlight(i));
        
        // Add hover event listeners for f(x_i) values
        yCell.addEventListener('mouseenter', () => highlightMathElement(i));
        yCell.addEventListener('mouseleave', () => clearMathHighlight(i));
        
        row.appendChild(idxCell);
        row.appendChild(xCell);
        row.appendChild(yCell);
        pointsTableBody.appendChild(row);
    });
    if (hoverPoint) {
        const row = document.createElement('tr');
        row.classList.add('ghost-row');
        const idxCell = document.createElement('td');
        const xCell = document.createElement('td');
        const yCell = document.createElement('td');
        idxCell.textContent = points.length + 1;
        xCell.textContent = hoverPoint.x.toFixed(3);
        yCell.textContent = hoverPoint.y.toFixed(3);
        row.appendChild(idxCell);
        row.appendChild(xCell);
        row.appendChild(yCell);
        pointsTableBody.appendChild(row);
    }
}

// Highlight corresponding math element for f(x_i)
function highlightMathElement(pointIndex) {
    const mathElement = document.getElementById(`fx${pointIndex + 1}`);
    if (mathElement) {
        mathElement.classList.add('hl-hover');
    }
}

// Clear math element highlight for f(x_i)
function clearMathHighlight(pointIndex) {
    const mathElement = document.getElementById(`fx${pointIndex + 1}`);
    if (mathElement) {
        mathElement.classList.remove('hl-hover');
    }
}

// Highlight all x_i elements in the math expression
function highlightXiElements(pointIndex) {
    const xiIndex = pointIndex + 1;
    // Find all elements with IDs that start with "x" followed by the index, but NOT "fx"
    const elements = document.querySelectorAll(`[id^="x${xiIndex}"]`);
    elements.forEach(element => {
        // Make sure we don't highlight f(x_i) elements
        if (!element.id.startsWith('fx')) {
            element.classList.add('hl-hover');
        }
    });
}

// Clear highlight for all x_i elements
function clearXiHighlight(pointIndex) {
    const xiIndex = pointIndex + 1;
    // Find all elements with IDs that start with "x" followed by the index, but NOT "fx"
    const elements = document.querySelectorAll(`[id^="x${xiIndex}"]`);
    elements.forEach(element => {
        // Make sure we don't unhighlight f(x_i) elements
        if (!element.id.startsWith('fx')) {
            element.classList.remove('hl-hover');
        }
    });
}

// Format one basis term symbolically with highlighting and optional CSS class
function formatBasisSymbolic(allPoints, j, cssClass = null) {
    const n = allPoints.length;
    let numParts = [];
    let denomParts = [];
    for (let m = 0; m < n; m++) {
        if (m === j) continue;
        numParts.push(`(x - \\cssId{x${m + 1}num${j + 1}}{x_{${m + 1}}})`);
        denomParts.push(`(\\cssId{x${j + 1}denom${j + 1}}{x_{${j + 1}}} - \\cssId{x${m + 1}denom${j + 1}}{x_{${m + 1}}})`);
    }
    const fSym = `\\cssId{fx${j + 1}}{f(x_{${j + 1}})}`;
    const numExpr = numParts.join("\\cdot ");
    const denomExpr = denomParts.join("\\cdot ");
    const termContent = `\\frac{${numExpr}}{${denomExpr}} \\cdot ${fSym}`;
    
    // Wrap with CSS class if provided
    if (cssClass && showBasisCurves) {
        return `\\class{${cssClass}}{${termContent}}`;
    }
    return termContent;
}

// Format one basis term numerically with highlighting and optional CSS class
function formatBasisNumeric(allPoints, j, cssClass = null) {
    const n = allPoints.length;
    let numParts = [];
    let denomParts = [];
    for (let m = 0; m < n; m++) {
        if (m === j) continue;
        const xm = allPoints[m].x.toFixed(3);
        numParts.push(`(x - \\cssId{x${m + 1}num${j + 1}}{${xm}})`);
        const xj = allPoints[j].x.toFixed(3);
        denomParts.push(`(\\cssId{x${j + 1}denom${j + 1}}{${xj}} - \\cssId{x${m + 1}denom${j + 1}}{${xm}})`);
    }
    const yj = allPoints[j].y.toFixed(3);
    const numExpr = numParts.join("\\cdot ");
    const denomExpr = denomParts.join("\\cdot ");
    const termContent = `\\frac{${numExpr}}{${denomExpr}} \\cdot \\cssId{fx${j + 1}}{(${yj})}`;
    
    // Wrap with CSS class if provided
    if (cssClass && showBasisCurves) {
        return `\\class{${cssClass}}{${termContent}}`;
    }
    return termContent;
}

// Update math display: show only the current polynomial
function updateMath() {
    mathDisplay.innerHTML = '';
    
    // Update CSS styles for basis term backgrounds
    updateBasisStyles();
    
    // Current polynomial only
    const curDiv = document.createElement('div');
    curDiv.classList.add('latex-block');
    
    let curHtml = `<strong>Lagrange Polynomial (n = ${points.length}):</strong><br/>`;
    if (points.length === 0) {
        curHtml += `No points defined.`;
        curDiv.innerHTML = curHtml;
        mathDisplay.appendChild(curDiv);
        return;
    } else if (points.length === 1) {
        const yVal = points[0].y.toFixed(3);
        const cssClass = showBasisCurves ? `basis-term-0` : null;
        const termContent = `\\cssId{fx1}{${yVal}}`;
        const finalTerm = cssClass ? `\\class{${cssClass}}{${termContent}}` : termContent;
        curHtml += `$$P(x) = ${finalTerm}$$`;
    } else {
        let terms = [];
        for (let j = 0; j < points.length; j++) {
            const cssClass = showBasisCurves ? `basis-term-${j}` : null;
            const termTex = displayNumeric
                ? formatBasisNumeric(points, j, cssClass)
                : formatBasisSymbolic(points, j, cssClass);
            terms.push(termTex);
        }
        curHtml += `$$P(x) = ${terms.join(' + ')}$$`;
    }
    
    curDiv.innerHTML = curHtml;
    mathDisplay.appendChild(curDiv);

    if (window.MathJax && MathJax.typesetPromise) {
        MathJax.typesetPromise([curDiv]).then(() => {
            // After MathJax renders, check if we need to scale
            const mathElement = curDiv.querySelector('.MathJax');
            if (mathElement) {
                const containerWidth = mathDisplay.clientWidth - 20; // Account for padding
                const mathWidth = mathElement.scrollWidth;
                
                if (mathWidth > containerWidth) {
                    // Calculate scale factor needed
                    const scaleFactor = containerWidth / mathWidth;
                    
                    // Apply CSS transform scaling with proper origin
                    mathElement.style.transform = `scale(${scaleFactor})`;
                    mathElement.style.transformOrigin = 'left center';
                    mathElement.style.display = 'inline-block';
                    
                    // Adjust the container height to account for scaling
                    const originalHeight = mathElement.offsetHeight;
                    const scaledHeight = originalHeight * scaleFactor;
                    curDiv.style.height = scaledHeight + 'px';
                }
            }
        });
    }
}

// Redraw everything
function redrawAll() {
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    drawAxes();
    const allPoints = points.slice();
    if (hoverPoint) allPoints.push({ x: hoverPoint.x, y: hoverPoint.y });
    drawBasisCurves(allPoints);
    drawFullPolynomial(allPoints);
    drawPoints();
    updateTable();
    updateMath();
}

// Mouse interaction
canvas.addEventListener('click', e => {
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const { x, y } = canvasToCoord(cx, cy);
    const radiusCoord = (POINT_RADIUS / CANVAS_SIZE) * (X_MAX - X_MIN);
    let removeIdx = -1;
    for (let i = 0; i < points.length; i++) {
        const dx = x - points[i].x;
        const dy = y - points[i].y;
        if (Math.hypot(dx, dy) < radiusCoord * 1.5) { removeIdx = i; break; }
    }
    if (removeIdx >= 0) points.splice(removeIdx, 1);
    else points.push({ x, y });
    hoverPoint = null;
    redrawAll();
});
canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { x, y } = canvasToCoord(mx, my);
    hoverPoint = { x, y };
    redrawAll();
});
canvas.addEventListener('mouseleave', () => {
    hoverPoint = null;
    redrawAll();
});

toggleNumeric.addEventListener('change', () => {
    displayNumeric = toggleNumeric.checked;
    redrawAll();
});

toggleBasisCurves.addEventListener('change', () => {
    showBasisCurves = toggleBasisCurves.checked;
    redrawAll();
});

document.getElementById('clearBtn').addEventListener('click', () => {
    points = [];
    hoverPoint = null;
    redrawAll();
});

// Handle window resize to re-adjust math scaling
window.addEventListener('resize', () => {
    setTimeout(updateMath, 200);
});

// Initial draw
redrawAll();
