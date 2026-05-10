// logic.js - Complete Flappy Bird Game Engine
// Enhanced visuals, physics, touch controls, full-screen responsive
// v2: Boosted sound effects for clear mobile audio
// v3: Dynamic difficulty, mute button, auto-pause, day/night cycle, medal tiers

(function () {
    'use strict';

    // ─────────────────────────────────────
    // DOM ELEMENTS & CANVAS SETUP
    // ─────────────────────────────────────
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');

    // ─────────────────────────────────────
    // AUDIO ENGINE (Synthesized sounds, louder output)
    // ─────────────────────────────────────
    let audioCtx = null;
    let masterGain = null; // master volume node
    let isMuted = false;   // mute toggle

    function initAudio() {
        if (!audioCtx) {
            try {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                // Create a master gain node to boost overall volume
                masterGain = audioCtx.createGain();
                masterGain.gain.value = isMuted ? 0 : 1.0; // respect mute state
                masterGain.connect(audioCtx.destination);
            } catch (e) {
                audioCtx = null;
                masterGain = null;
            }
        }
        // Resume if suspended (browser autoplay policy)
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        // Ensure gain state matches mute setting
        if (masterGain) {
            masterGain.gain.value = isMuted ? 0 : 1.0;
        }
    }

    function playBeep(freq, duration, type = 'square', vol = 0.3, glideTo = null) {
        if (!audioCtx || !masterGain) return;
        try {
            const t = audioCtx.currentTime;
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, t);
            if (glideTo) {
                osc.frequency.linearRampToValueAtTime(glideTo, t + duration);
            }
            // Apply higher gain values for better audibility
            gain.gain.setValueAtTime(vol, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
            osc.connect(gain);
            gain.connect(masterGain); // route through master gain
            osc.start(t);
            osc.stop(t + duration);
        } catch (e) {
            // Silently fail audio
        }
    }

    function sfxFlap() {
        // Louder flap sound
        playBeep(420, 0.08, 'sine', 0.35, 520);
    }

    function sfxScore() {
        playBeep(880, 0.08, 'sine', 0.3);
        setTimeout(() => playBeep(1100, 0.1, 'sine', 0.3), 80);
    }

    function sfxHit() {
        // Stronger hit sound
        playBeep(150, 0.25, 'triangle', 0.45, 60);
        playBeep(80, 0.3, 'sawtooth', 0.35, 40);
    }

    function sfxSwoosh() {
        playBeep(600, 0.12, 'sine', 0.25, 300);
    }

    function sfxStart() {
        // Pleasant start chime
        playBeep(660, 0.1, 'sine', 0.25);
        setTimeout(() => playBeep(880, 0.12, 'sine', 0.25), 80);
    }

    // ─────────────────────────────────────
    // CANVAS RESIZE & SCALING
    // ─────────────────────────────────────
    const REFERENCE_WIDTH = 400; // Base design width for scaling
    let canvasWidth, canvasHeight, scale;
    let groundHeight, birdRadius, pipeWidth, pipeGap, pipeSpeed;
    let gravity, flapVelocity, maxFallSpeed;
    let pipeSpawnInterval;
    let muteBtnX, muteBtnY, muteBtnSize;  // <-- ADDED DECLARATION

    // Baseline difficulty values (captured after dimension update)
    let basePipeSpeed, basePipeGap, basePipeSpawnInterval;
    let difficultyLevel = 0;
    const MAX_DIFFICULTY = 10;

    function updateDimensions() {
        canvasWidth = window.innerWidth;
        canvasHeight = window.innerHeight;

        // Set canvas buffer size
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;

        // Calculate scale based on reference width
        scale = canvasWidth / REFERENCE_WIDTH;

        // Derive all game dimensions from scale
        groundHeight = Math.round(75 * scale);
        birdRadius = Math.round(16 * scale);
        pipeWidth = Math.round(50 * scale);
        pipeGap = Math.round(148 * scale);
        pipeSpeed = 130 * scale; // pixels per second
        gravity = 880 * scale; // pixels per second squared
        flapVelocity = -340 * scale; // pixels per second (negative = upward)
        maxFallSpeed = 520 * scale;
        pipeSpawnInterval = 270 * scale; // horizontal distance between pipes

        // Store baseline for difficulty scaling
        basePipeSpeed = pipeSpeed;
        basePipeGap = pipeGap;
        basePipeSpawnInterval = pipeSpawnInterval;

        // Apply current difficulty after resize
        applyDifficulty();

        // Mute button position
        muteBtnSize = 26 * scale;
        muteBtnX = canvasWidth - 45 * scale;
        muteBtnY = 35 * scale;
    }

    function applyDifficulty() {
        const level = Math.min(difficultyLevel, MAX_DIFFICULTY);
        pipeSpeed = basePipeSpeed * (1 + level * 0.04);
        pipeGap = Math.max(basePipeGap * 0.5, basePipeGap * (1 - level * 0.02));
        pipeSpawnInterval = basePipeSpawnInterval * (1 - level * 0.03);
    }

    updateDimensions();

    // ─────────────────────────────────────
    // GAME STATE
    // ─────────────────────────────────────
    const STATE = {
        IDLE: 'idle',
        PLAYING: 'playing',
        DYING: 'dying',
        GAMEOVER: 'gameover',
        PAUSED: 'paused'
    };
    let gameState = STATE.IDLE;

    // ─────────────────────────────────────
    // BIRD
    // ─────────────────────────────────────
    const bird = {
        x: 0,
        y: 0,
        velocity: 0,
        rotation: 0,
        wingPhase: 0,
        wingFlapTimer: 0,
        eyeBlinkTimer: 0,
        isBlinking: false,
        trailParticles: [],

        reset() {
            this.x = canvasWidth * 0.28;
            this.y = canvasHeight * 0.45;
            this.velocity = 0;
            this.rotation = 0;
            this.wingPhase = 0;
            this.wingFlapTimer = 0;
            this.eyeBlinkTimer = Math.random() * 4 + 2;
            this.isBlinking = false;
            this.trailParticles = [];
        },

        flap() {
            if (gameState === STATE.PLAYING) {
                this.velocity = flapVelocity;
                this.wingFlapTimer = 0.25;
                this.rotation = -0.5; // Quick upward tilt
                sfxFlap();
                // Spawn flap particles
                for (let i = 0; i < 6; i++) {
                    this.trailParticles.push({
                        x: this.x - birdRadius * 0.6,
                        y: this.y + birdRadius * 0.4,
                        vx: -Math.random() * 80 * scale - 40 * scale,
                        vy: Math.random() * 60 * scale - 30 * scale,
                        life: 0.4 + Math.random() * 0.3,
                        maxLife: 0.5,
                        size: (2 + Math.random() * 3) * scale,
                    });
                }
            } else if (gameState === STATE.IDLE) {
                // First flap when starting
                this.velocity = flapVelocity * 0.7;
                this.wingFlapTimer = 0.2;
                this.rotation = -0.35;
                sfxStart(); // distinct start sound
            }
        },

        update(dt) {
            // Update wing flap timer
            if (this.wingFlapTimer > 0) {
                this.wingFlapTimer -= dt;
                this.wingPhase += dt * 18;
            } else {
                // Gentle wing bobbing when not flapping
                this.wingPhase += dt * 5;
            }

            // Eye blink
            this.eyeBlinkTimer -= dt;
            if (this.eyeBlinkTimer <= 0) {
                this.isBlinking = true;
                setTimeout(() => {
                    this.isBlinking = false;
                }, 100);
                this.eyeBlinkTimer = Math.random() * 5 + 2;
            }

            // Update trail particles
            for (let i = this.trailParticles.length - 1; i >= 0; i--) {
                const p = this.trailParticles[i];
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.life -= dt;
                if (p.life <= 0) {
                    this.trailParticles.splice(i, 1);
                }
            }

            if (gameState === STATE.IDLE) {
                // Gentle bobbing in idle
                this.y = canvasHeight * 0.45 + Math.sin(Date.now() / 600) * (12 * scale);
                this.rotation = Math.sin(Date.now() / 500) * 0.08;
                return;
            }

            if (gameState === STATE.DYING) {
                // Bird falls after death
                this.velocity += gravity * dt;
                if (this.velocity > maxFallSpeed) this.velocity = maxFallSpeed;
                this.y += this.velocity * dt;
                this.rotation += dt * 5;
                if (this.rotation > 1.5) this.rotation = 1.5;
                // Check ground collision
                const groundY = canvasHeight - groundHeight;
                if (this.y + birdRadius >= groundY) {
                    this.y = groundY - birdRadius;
                    this.velocity = 0;
                    if (gameState === STATE.DYING) {
                        gameState = STATE.GAMEOVER;
                        this.rotation = 1.4;
                    }
                }
                return;
            }

            // Playing state physics
            this.velocity += gravity * dt;
            if (this.velocity > maxFallSpeed) this.velocity = maxFallSpeed;
            this.y += this.velocity * dt;

            // Smooth rotation based on velocity
            const targetRotation = Math.max(-0.55, Math.min(1.3, this.velocity / (maxFallSpeed * 0.7) * 1.2));
            this.rotation += (targetRotation - this.rotation) * Math.min(1, dt * 10);

            // Ground collision
            const groundY = canvasHeight - groundHeight;
            if (this.y + birdRadius >= groundY) {
                this.y = groundY - birdRadius;
                this.velocity = 0;
                this.rotation = 1.3;
                triggerDeath();
            }

            // Ceiling collision
            if (this.y - birdRadius <= 0) {
                this.y = birdRadius;
                this.velocity = Math.max(0, this.velocity);
            }
        },
    };

    // ─────────────────────────────────────
    // PIPES
    // ─────────────────────────────────────
    let pipes = [];
    let pipeTimer = 0;
    let pipesPassed = 0;

    function spawnPipe() {
        const groundY = canvasHeight - groundHeight;
        const availableHeight = groundY - (60 * scale) - (60 * scale);
        const minGapCenter = 60 * scale + pipeGap / 2;
        const maxGapCenter = groundY - 60 * scale - pipeGap / 2;
        const gapCenterY = minGapCenter + Math.random() * (maxGapCenter - minGapCenter);

        const topPipeBottom = gapCenterY - pipeGap / 2;
        const bottomPipeTop = gapCenterY + pipeGap / 2;

        pipes.push({
            x: canvasWidth + pipeWidth,
            gapCenterY: gapCenterY,
            topHeight: topPipeBottom,
            bottomY: bottomPipeTop,
            width: pipeWidth,
            scored: false,
            shade: 0.85 + Math.random() * 0.15,
        });
    }

    function resetPipes() {
        pipes = [];
        pipeTimer = 0;
        pipesPassed = 0;
        difficultyLevel = 0;
        applyDifficulty();
        // Spawn initial pipe after a short delay
        pipeTimer = pipeSpawnInterval * 0.6;
    }

    function updatePipes(dt) {
        if (gameState !== STATE.PLAYING && gameState !== STATE.DYING) return;

        const speed = pipeSpeed * (gameState === STATE.DYING ? 0 : 1);

        // Move pipes
        for (let i = pipes.length - 1; i >= 0; i--) {
            pipes[i].x -= speed * dt;

            // Remove off-screen pipes
            if (pipes[i].x < -pipeWidth * 2) {
                pipes.splice(i, 1);
            }
        }

        // Spawn new pipes
        if (gameState === STATE.PLAYING) {
            pipeTimer -= speed * dt;
            if (pipeTimer <= 0) {
                spawnPipe();
                pipeTimer = pipeSpawnInterval;
                // Slight variation in spacing
                pipeTimer += (Math.random() - 0.5) * 60 * scale;
            }
        }
    }

    // ─────────────────────────────────────
    // PARTICLES (Score celebration)
    // ─────────────────────────────────────
    let celebrationParticles = [];

    function spawnCelebration(x, y) {
        const count = 18;
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
            const speed = (80 + Math.random() * 180) * scale;
            celebrationParticles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 0.6 + Math.random() * 0.7,
                maxLife: 0.8,
                size: (3 + Math.random() * 5) * scale,
                hue: 40 + Math.random() * 30,
            });
        }
    }

    function updateCelebrationParticles(dt) {
        for (let i = celebrationParticles.length - 1; i >= 0; i--) {
            const p = celebrationParticles[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += gravity * 0.5 * dt;
            p.life -= dt;
            if (p.life <= 0) {
                celebrationParticles.splice(i, 1);
            }
        }
    }

    // ─────────────────────────────────────
    // SCREEN SHAKE
    // ─────────────────────────────────────
    let shakeAmount = 0;
    let shakeDuration = 0;

    function triggerShake(intensity, duration) {
        shakeAmount = intensity * scale;
        shakeDuration = duration;
    }

    function getShakeOffset() {
        if (shakeDuration <= 0) return { x: 0, y: 0 };
        return {
            x: (Math.random() - 0.5) * 2 * shakeAmount,
            y: (Math.random() - 0.5) * 2 * shakeAmount,
        };
    }

    function updateShake(dt) {
        if (shakeDuration > 0) {
            shakeDuration -= dt;
            if (shakeDuration <= 0) {
                shakeAmount = 0;
            } else {
                shakeAmount *= 0.85;
            }
        }
    }

    // ─────────────────────────────────────
    // CLOUDS (Background parallax)
    // ─────────────────────────────────────
    let clouds = [];

    function initClouds() {
        clouds = [];
        const cloudCount = Math.floor(canvasWidth / 150) + 3;
        for (let i = 0; i < cloudCount; i++) {
            clouds.push({
                x: Math.random() * canvasWidth,
                y: Math.random() * canvasHeight * 0.55,
                width: (40 + Math.random() * 80) * scale,
                height: (18 + Math.random() * 30) * scale,
                speed: (15 + Math.random() * 30) * scale,
                opacity: 0.3 + Math.random() * 0.5,
            });
        }
    }

    function updateClouds(dt) {
        for (const cloud of clouds) {
            cloud.x -= cloud.speed * dt;
            if (cloud.x + cloud.width < -20) {
                cloud.x = canvasWidth + 20;
                cloud.y = Math.random() * canvasHeight * 0.55;
            }
        }
    }

    // ─────────────────────────────────────
    // SCORE & UI
    // ─────────────────────────────────────
    let score = 0;
    let bestScore = 0;
    let scorePopTimer = 0;
    let scorePopScale = 1;

    // Load best score from localStorage
    try {
        const saved = localStorage.getItem('flappyBirdBestScore');
        if (saved !== null) bestScore = parseInt(saved, 10) || 0;
    } catch (e) {
        bestScore = 0;
    }

    function saveBestScore() {
        try {
            localStorage.setItem('flappyBirdBestScore', bestScore.toString());
        } catch (e) {
            // Storage not available
        }
    }

    function incrementScore() {
        score++;
        scorePopTimer = 0.35;
        scorePopScale = 1.5;
        if (score > bestScore) {
            bestScore = score;
            saveBestScore();
        }
        sfxScore();
        // Spawn celebration at bird position
        spawnCelebration(bird.x + birdRadius, bird.y);
    }

    // ─────────────────────────────────────
    // COLLISION DETECTION
    // ─────────────────────────────────────
    function checkCollision(pipe) {
        const bx = bird.x;
        const by = bird.y;
        const br = birdRadius * 0.78; // Slightly smaller hitbox for fairness

        // Check top pipe
        const topRect = {
            x: pipe.x - pipe.width / 2,
            y: 0,
            w: pipe.width,
            h: pipe.topHeight,
        };

        // Check bottom pipe
        const bottomRect = {
            x: pipe.x - pipe.width / 2,
            y: pipe.bottomY,
            w: pipe.width,
            h: canvasHeight - groundHeight - pipe.bottomY,
        };

        // Circle-rect collision
        if (circleRectCollision(bx, by, br, topRect)) return true;
        if (circleRectCollision(bx, by, br, bottomRect)) return true;

        return false;
    }

    function circleRectCollision(cx, cy, cr, rect) {
        const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
        const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
        const dx = cx - closestX;
        const dy = cy - closestY;
        return dx * dx + dy * dy < cr * cr;
    }

    function checkScoring(pipe) {
        if (!pipe.scored && pipe.x + pipe.width / 2 < bird.x) {
            pipe.scored = true;
            incrementScore();
            pipesPassed++;
            // Difficulty progression every 10 pipes
            if (pipesPassed % 10 === 0 && pipesPassed > 0 && difficultyLevel < MAX_DIFFICULTY) {
                difficultyLevel++;
                applyDifficulty();
            }
        }
    }

    function triggerDeath() {
        if (gameState !== STATE.PLAYING) return;
        gameState = STATE.DYING;
        sfxHit();
        triggerShake(8, 0.4);
        bird.velocity = flapVelocity * 0.4;
        // Spawn death particles
        for (let i = 0; i < 20; i++) {
            celebrationParticles.push({
                x: bird.x,
                y: bird.y,
                vx: (Math.random() - 0.5) * 250 * scale,
                vy: (Math.random() - 0.5) * 250 * scale,
                life: 0.5 + Math.random() * 0.8,
                maxLife: 0.9,
                size: (2 + Math.random() * 4) * scale,
                hue: 10 + Math.random() * 20,
            });
        }
    }

    // ─────────────────────────────────────
    // DAY/NIGHT CYCLE COLOR HELPERS
    // ─────────────────────────────────────
    const skyPhases = [
        { // Day (0.0)
            stops: [
                { pos: 0, color: [135, 206, 235] },
                { pos: 0.5, color: [184, 228, 240] },
                { pos: 0.85, color: [212, 238, 247] },
                { pos: 1, color: [232, 244, 248] }
            ]
        },
        { // Sunset (0.25)
            stops: [
                { pos: 0, color: [255, 126, 95] },
                { pos: 0.5, color: [254, 180, 123] },
                { pos: 0.85, color: [255, 224, 178] },
                { pos: 1, color: [255, 249, 196] }
            ]
        },
        { // Night (0.5)
            stops: [
                { pos: 0, color: [15, 32, 39] },
                { pos: 0.5, color: [32, 58, 67] },
                { pos: 0.85, color: [44, 83, 100] },
                { pos: 1, color: [30, 47, 63] }
            ]
        },
        { // Dawn (0.75)
            stops: [
                { pos: 0, color: [95, 75, 139] },
                { pos: 0.5, color: [155, 114, 207] },
                { pos: 0.85, color: [212, 165, 255] },
                { pos: 1, color: [232, 213, 244] }
            ]
        },
        { // Day again (1.0) – identical to first
            stops: [
                { pos: 0, color: [135, 206, 235] },
                { pos: 0.5, color: [184, 228, 240] },
                { pos: 0.85, color: [212, 238, 247] },
                { pos: 1, color: [232, 244, 248] }
            ]
        }
    ];

    function lerpColor(c1, c2, t) {
        return [
            Math.round(c1[0] + (c2[0] - c1[0]) * t),
            Math.round(c1[1] + (c2[1] - c1[1]) * t),
            Math.round(c1[2] + (c2[2] - c1[2]) * t)
        ];
    }

    function getSkyColors(timeFactor) {
        // timeFactor 0..1, maps to 4 segments
        const seg = timeFactor * 4;
        const idx = Math.floor(seg);
        const nextIdx = (idx + 1) % 5;
        const localT = seg - idx;

        const phaseA = skyPhases[idx];
        const phaseB = skyPhases[nextIdx];

        return phaseA.stops.map((stopA, i) => ({
            pos: stopA.pos,
            color: lerpColor(stopA.color, phaseB.stops[i].color, localT)
        }));
    }

    function getTimeFactor() {
        const cycleLength = 100; // complete day/night cycle every 100 points
        return (score % cycleLength) / cycleLength;
    }

    // ─────────────────────────────────────
    // RENDERING
    // ─────────────────────────────────────
    function drawSky() {
        const t = getTimeFactor();
        const stops = getSkyColors(t);

        const skyGrad = ctx.createLinearGradient(0, 0, 0, canvasHeight);
        for (const s of stops) {
            skyGrad.addColorStop(s.pos, `rgb(${s.color[0]},${s.color[1]},${s.color[2]})`);
        }

        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        // Subtle sun/moon glow (sun during day, moon at night)
        const sunX = canvasWidth * 0.78;
        const sunY = canvasHeight * 0.15;
        let glowColor;
        if (t < 0.25 || t >= 0.75) {
            glowColor = 'rgba(255,255,240,0.5)';
        } else if (t < 0.5) {
            glowColor = 'rgba(255,200,150,0.4)';
        } else {
            glowColor = 'rgba(200,220,255,0.35)';
        }
        const sunGrad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, canvasWidth * 0.4);
        sunGrad.addColorStop(0, glowColor);
        sunGrad.addColorStop(0.3, glowColor.replace('0.5', '0.25').replace('0.4', '0.2').replace('0.35', '0.2'));
        sunGrad.addColorStop(0.7, 'rgba(255,240,210,0.05)');
        sunGrad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = sunGrad;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }

    function drawClouds() {
        for (const cloud of clouds) {
            ctx.save();
            ctx.globalAlpha = cloud.opacity;
            ctx.fillStyle = '#ffffff';
            const cx = cloud.x;
            const cy = cloud.y;
            const r = cloud.height * 0.5;

            // Draw cloud as overlapping circles
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.arc(cx + r * 1.1, cy - r * 0.3, r * 0.75, 0, Math.PI * 2);
            ctx.arc(cx - r * 0.9, cy - r * 0.15, r * 0.7, 0, Math.PI * 2);
            ctx.arc(cx + r * 0.3, cy - r * 0.55, r * 0.65, 0, Math.PI * 2);
            ctx.arc(cx - r * 0.4, cy - r * 0.5, r * 0.55, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    function drawGround() {
        const groundY = canvasHeight - groundHeight;

        // Main ground
        const groundGrad = ctx.createLinearGradient(0, groundY, 0, canvasHeight);
        groundGrad.addColorStop(0, '#8BC34A');
        groundGrad.addColorStop(0.03, '#7CB342');
        groundGrad.addColorStop(0.08, '#6B8E3D');
        groundGrad.addColorStop(0.3, '#8B7355');
        groundGrad.addColorStop(0.7, '#6B5A3E');
        groundGrad.addColorStop(1, '#5C4A30');
        ctx.fillStyle = groundGrad;
        ctx.fillRect(0, groundY, canvasWidth, groundHeight);

        // Grass line at top of ground
        ctx.fillStyle = '#9CCC65';
        ctx.fillRect(0, groundY, canvasWidth, Math.round(3 * scale));

        // Grass blades
        ctx.strokeStyle = '#7CB342';
        ctx.lineWidth = Math.max(1, 1.5 * scale);
        const grassSpacing = 14 * scale;
        const timeOffset = Date.now() / 200;
        for (let x = (timeOffset % grassSpacing); x < canvasWidth; x += grassSpacing) {
            const bladeH = (3 + Math.sin(x * 0.3 + timeOffset) * 2) * scale;
            ctx.beginPath();
            ctx.moveTo(x, groundY);
            ctx.lineTo(x + 2 * scale, groundY - bladeH);
            ctx.stroke();
        }

        // Subtle texture dots on ground
        ctx.fillStyle = 'rgba(0,0,0,0.06)';
        for (let x = 0; x < canvasWidth; x += 30 * scale) {
            for (let y = groundY + 20 * scale; y < canvasHeight; y += 25 * scale) {
                ctx.beginPath();
                ctx.arc(x + Math.sin(y * 0.5) * 8 * scale, y, 1.2 * scale, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    function drawPipe(pipe) {
        const x = pipe.x;
        const topBottom = pipe.topHeight;
        const bottomTop = pipe.bottomY;
        const w = pipe.width;
        const lipWidth = w * 1.3;
        const lipHeight = Math.round(8 * scale);
        const groundY = canvasHeight - groundHeight;

        // Pipe gradient (green with 3D effect)
        const pipeGradH = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
        const shade = pipe.shade;
        pipeGradH.addColorStop(0, `rgb(${Math.round(60*shade)},${Math.round(160*shade)},${Math.round(50*shade)})`);
        pipeGradH.addColorStop(0.35, `rgb(${Math.round(100*shade)},${Math.round(200*shade)},${Math.round(70*shade)})`);
        pipeGradH.addColorStop(0.5, `rgb(${Math.round(130*shade)},${Math.round(215*shade)},${Math.round(85*shade)})`);
        pipeGradH.addColorStop(0.65, `rgb(${Math.round(100*shade)},${Math.round(195*shade)},${Math.round(65*shade)})`);
        pipeGradH.addColorStop(1, `rgb(${Math.round(55*shade)},${Math.round(140*shade)},${Math.round(40*shade)})`);

        // ── Top Pipe ──
        // Main body
        ctx.fillStyle = pipeGradH;
        ctx.fillRect(x - w / 2, 0, w, topBottom - lipHeight);

        // Lip
        ctx.fillStyle = pipeGradH;
        ctx.fillRect(x - lipWidth / 2, topBottom - lipHeight, lipWidth, lipHeight);

        // Lip highlight
        const lipGrad = ctx.createLinearGradient(0, topBottom - lipHeight, 0, topBottom);
        lipGrad.addColorStop(0, 'rgba(255,255,255,0.2)');
        lipGrad.addColorStop(0.5, 'rgba(255,255,255,0.05)');
        lipGrad.addColorStop(1, 'rgba(0,0,0,0.15)');
        ctx.fillStyle = lipGrad;
        ctx.fillRect(x - lipWidth / 2, topBottom - lipHeight, lipWidth, lipHeight);

        // Dark outline
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = Math.max(1.5, 2 * scale);
        ctx.strokeRect(x - w / 2, 0, w, topBottom);
        ctx.strokeRect(x - lipWidth / 2, topBottom - lipHeight, lipWidth, lipHeight);

        // ── Bottom Pipe ──
        const bottomPipeHeight = groundY - bottomTop;
        ctx.fillStyle = pipeGradH;
        ctx.fillRect(x - w / 2, bottomTop + lipHeight, w, bottomPipeHeight - lipHeight);

        // Lip
        ctx.fillStyle = pipeGradH;
        ctx.fillRect(x - lipWidth / 2, bottomTop, lipWidth, lipHeight);

        // Lip shadow
        const lipGrad2 = ctx.createLinearGradient(0, bottomTop, 0, bottomTop + lipHeight);
        lipGrad2.addColorStop(0, 'rgba(0,0,0,0.2)');
        lipGrad2.addColorStop(0.5, 'rgba(0,0,0,0.05)');
        lipGrad2.addColorStop(1, 'rgba(255,255,255,0.1)');
        ctx.fillStyle = lipGrad2;
        ctx.fillRect(x - lipWidth / 2, bottomTop, lipWidth, lipHeight);

        // Dark outline
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.strokeRect(x - w / 2, bottomTop, w, bottomPipeHeight);
        ctx.strokeRect(x - lipWidth / 2, bottomTop, lipWidth, lipHeight);
    }

    function drawBird() {
        ctx.save();
        ctx.translate(bird.x, bird.y);
        ctx.rotate(bird.rotation);

        const r = birdRadius;
        const bodyColor = '#FF6B35';
        const bellyColor = '#FFB88C';
        const wingColor = '#FF8C5A';
        const wingDark = '#E85D2C';

        // Body shadow
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.beginPath();
        ctx.arc(1.5 * scale, 1.5 * scale, r, 0, Math.PI * 2);
        ctx.fill();

        // Main body
        const bodyGrad = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.1, 0, 0, r);
        bodyGrad.addColorStop(0, '#FF9A65');
        bodyGrad.addColorStop(0.5, bodyColor);
        bodyGrad.addColorStop(1, '#D94A1E');
        ctx.fillStyle = bodyGrad;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();

        // Belly
        const bellyGrad = ctx.createRadialGradient(r * 0.15, r * 0.2, r * 0.05, 0, r * 0.1, r * 0.7);
        bellyGrad.addColorStop(0, bellyColor);
        bellyGrad.addColorStop(1, 'rgba(255,180,130,0.3)');
        ctx.fillStyle = bellyGrad;
        ctx.beginPath();
        ctx.arc(r * 0.05, r * 0.15, r * 0.62, 0, Math.PI * 2);
        ctx.fill();

        // Wing
        const wingAngle = Math.sin(bird.wingPhase) * 0.7;
        ctx.save();
        ctx.translate(-r * 0.2, -r * 0.05);
        ctx.rotate(wingAngle - 0.2);
        const wingGrad = ctx.createLinearGradient(0, -r * 0.5, 0, r * 0.5);
        wingGrad.addColorStop(0, wingColor);
        wingGrad.addColorStop(1, wingDark);
        ctx.fillStyle = wingGrad;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.55, r * 0.32, -0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.2)';
        ctx.lineWidth = Math.max(1, 1.2 * scale);
        ctx.stroke();
        ctx.restore();

        // Eye (white)
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(r * 0.35, -r * 0.25, r * 0.28, 0, Math.PI * 2);
        ctx.fill();

        // Eye outline
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = Math.max(0.8, scale * 0.8);
        ctx.stroke();

        // Pupil
        if (bird.isBlinking) {
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(r * 0.2, -r * 0.27, r * 0.3, Math.max(1, scale * 1.5));
        } else {
            ctx.fillStyle = '#1a1a1a';
            ctx.beginPath();
            ctx.arc(r * 0.4, -r * 0.23, r * 0.13, 0, Math.PI * 2);
            ctx.fill();

            // Tiny highlight in pupil
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath();
            ctx.arc(r * 0.43, -r * 0.26, r * 0.05, 0, Math.PI * 2);
            ctx.fill();
        }

        // Beak
        ctx.fillStyle = '#FF8F00';
        ctx.beginPath();
        ctx.moveTo(r * 0.65, -r * 0.08);
        ctx.lineTo(r * 1.05, r * 0.0);
        ctx.lineTo(r * 0.65, r * 0.12);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = Math.max(0.7, scale * 0.7);
        ctx.stroke();

        // Beak highlight
        ctx.fillStyle = 'rgba(255,200,100,0.5)';
        ctx.beginPath();
        ctx.moveTo(r * 0.65, -r * 0.04);
        ctx.lineTo(r * 0.95, r * 0.01);
        ctx.lineTo(r * 0.65, r * 0.04);
        ctx.closePath();
        ctx.fill();

        ctx.restore();

        // Draw trail particles
        for (const p of bird.trailParticles) {
            const alpha = p.life / p.maxLife;
            ctx.fillStyle = `rgba(255,180,140,${alpha * 0.7})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function drawCelebrationParticles() {
        for (const p of celebrationParticles) {
            const alpha = Math.max(0, p.life / p.maxLife);
            const hue = p.hue || 45;
            ctx.fillStyle = `hsla(${hue}, 90%, 60%, ${alpha})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
            ctx.fill();

            // Glow
            ctx.fillStyle = `hsla(${hue}, 100%, 75%, ${alpha * 0.4})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * alpha * 1.8, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function drawScore() {
        // Score with pop animation
        const scoreScale = scorePopScale;
        const scoreY = canvasHeight * 0.12;

        ctx.save();
        ctx.translate(canvasWidth / 2, scoreY);
        ctx.scale(scoreScale, scoreScale);

        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.font = `bold ${Math.round(42 * scale)}px "Segoe UI", "Roboto", "Arial", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(score.toString(), 3 * scale, 3 * scale);

        // Main score
        const scoreGrad = ctx.createLinearGradient(0, -20 * scale, 0, 20 * scale);
        scoreGrad.addColorStop(0, '#FFFFFF');
        scoreGrad.addColorStop(0.5, '#F5F5F5');
        scoreGrad.addColorStop(1, '#DDDDDD');
        ctx.fillStyle = scoreGrad;
        ctx.fillText(score.toString(), 0, 0);

        // Outline
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = Math.max(2, 3 * scale);
        ctx.strokeText(score.toString(), 0, 0);

        ctx.restore();
    }

    function drawMedal(x, y, size, tier) {
        if (tier <= 0) return;
        const colors = [
            null,
            ['#CD7F32', '#B8680A'], // bronze
            ['#C0C0C0', '#B0B0B0'], // silver
            ['#FFD700', '#FFC107']  // gold
        ];
        const [c1, c2] = colors[tier];
        const grad = ctx.createRadialGradient(x - size * 0.2, y - size * 0.2, size * 0.1, x, y, size);
        grad.addColorStop(0, c1);
        grad.addColorStop(1, c2);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = Math.max(1, 1.5 * scale);
        ctx.stroke();

        // Star
        ctx.fillStyle = '#FFF';
        ctx.font = `bold ${Math.round(size * 0.8)}px "Segoe UI", "Roboto", "Arial", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('★', x, y + 1 * scale);
    }

    function drawIdleUI() {
        // Best medal display (top center)
        const medalTier = getMedalTier(bestScore);
        if (medalTier > 0) {
            const mx = canvasWidth / 2;
            const my = canvasHeight * 0.22;
            const mSize = 18 * scale;
            drawMedal(mx, my, mSize, medalTier);

            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.font = `${Math.round(11 * scale)}px "Segoe UI", "Roboto", "Arial", sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText('Best Medal', mx, my + mSize + 14 * scale);

            // Also show best score
            ctx.fillText(`Best: ${bestScore}`, mx, my + mSize + 30 * scale);
        }

        // "Tap to Start" text
        const alpha = 0.6 + Math.sin(Date.now() / 800) * 0.4;
        const textY = canvasHeight * 0.38;

        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.font = `bold ${Math.round(22 * scale)}px "Segoe UI", "Roboto", "Arial", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Text shadow
        ctx.fillStyle = `rgba(0,0,0,0.3)`;
        ctx.fillText('Tap to Start', canvasWidth / 2 + 2 * scale, textY + 2 * scale);

        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.fillText('Tap to Start', canvasWidth / 2, textY);

        // Small instruction
        ctx.fillStyle = `rgba(255,255,255,${alpha * 0.7})`;
        ctx.font = `${Math.round(13 * scale)}px "Segoe UI", "Roboto", "Arial", sans-serif`;
        ctx.fillText('Tap screen to flap', canvasWidth / 2, textY + 30 * scale);
    }

    function drawGameOverUI() {
        // Semi-transparent overlay
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        // Game Over panel
        const panelW = Math.round(240 * scale);
        const panelH = Math.round(200 * scale);
        const panelX = canvasWidth / 2 - panelW / 2;
        const panelY = canvasHeight * 0.3;

        // Panel background
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath();
        ctx.roundRect(panelX, panelY, panelW, panelH, Math.round(16 * scale));
        ctx.fill();

        // Panel border
        ctx.strokeStyle = 'rgba(0,0,0,0.2)';
        ctx.lineWidth = Math.max(2, 2.5 * scale);
        ctx.stroke();

        // "Game Over" text
        ctx.fillStyle = '#E53935';
        ctx.font = `bold ${Math.round(28 * scale)}px "Segoe UI", "Roboto", "Arial", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Game Over', canvasWidth / 2, panelY + 36 * scale);

        // Score
        ctx.fillStyle = '#333';
        ctx.font = `bold ${Math.round(20 * scale)}px "Segoe UI", "Roboto", "Arial", sans-serif`;
        ctx.fillText(`Score: ${score}`, canvasWidth / 2, panelY + 78 * scale);

        // Best score
        ctx.fillStyle = '#FF6B35';
        ctx.font = `${Math.round(16 * scale)}px "Segoe UI", "Roboto", "Arial", sans-serif`;
        ctx.fillText(`Best: ${bestScore}`, canvasWidth / 2, panelY + 108 * scale);

        // Medal for current game
        const medalTier = getMedalTier(score);
        if (medalTier > 0) {
            drawMedal(canvasWidth / 2, panelY + 140 * scale, 20 * scale, medalTier);
        }
    }

    function drawPauseOverlay() {
        // Semi-transparent overlay
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = `bold ${Math.round(30 * scale)}px "Segoe UI", "Roboto", "Arial", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('PAUSED', canvasWidth / 2, canvasHeight * 0.4);

        ctx.font = `${Math.round(16 * scale)}px "Segoe UI", "Roboto", "Arial", sans-serif`;
        ctx.fillText('Tap to Resume', canvasWidth / 2, canvasHeight * 0.48);
    }

    function drawMuteButton() {
        const x = muteBtnX;
        const y = muteBtnY;
        const sz = muteBtnSize;

        ctx.save();
        ctx.translate(x, y);

        // Speaker body
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = Math.max(1.5, 1.5 * scale);
        ctx.fillRect(-sz * 0.55, -sz * 0.25, sz * 0.3, sz * 0.5);
        ctx.strokeRect(-sz * 0.55, -sz * 0.25, sz * 0.3, sz * 0.5);

        // Cone
        ctx.beginPath();
        ctx.moveTo(-sz * 0.25, -sz * 0.3);
        ctx.lineTo(sz * 0.2, -sz * 0.5);
        ctx.lineTo(sz * 0.2, sz * 0.5);
        ctx.lineTo(-sz * 0.25, sz * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        if (!isMuted) {
            // Sound waves
            ctx.beginPath();
            ctx.arc(sz * 0.1, 0, sz * 0.25, -Math.PI * 0.4, Math.PI * 0.4);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(sz * 0.2, 0, sz * 0.4, -Math.PI * 0.35, Math.PI * 0.35);
            ctx.stroke();
        } else {
            // X mark
            ctx.strokeStyle = 'rgba(255,0,0,0.85)';
            ctx.lineWidth = Math.max(2, 2.5 * scale);
            ctx.beginPath();
            ctx.moveTo(-sz * 0.4, -sz * 0.4);
            ctx.lineTo(sz * 0.4, sz * 0.4);
            ctx.moveTo(sz * 0.4, -sz * 0.4);
            ctx.lineTo(-sz * 0.4, sz * 0.4);
            ctx.stroke();
        }

        ctx.restore();
    }

    function drawDyingFlash() {
        if (gameState === STATE.DYING) {
            const flashAlpha = 0.25;
            ctx.fillStyle = `rgba(255,255,255,${flashAlpha})`;
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        }
    }

    // ─────────────────────────────────────
    // MEDAL TIER HELPER
    // ─────────────────────────────────────
    function getMedalTier(score) {
        if (score >= 50) return 3; // gold
        if (score >= 25) return 2; // silver
        if (score >= 10) return 1; // bronze
        return 0; // none
    }

    // ─────────────────────────────────────
    // MAIN GAME LOOP
    // ─────────────────────────────────────
    let lastTime = performance.now();
    let dtAccumulator = 0;
    const MAX_DT = 0.1; // Cap delta time to prevent physics tunneling

    function gameLoop(timestamp) {
        requestAnimationFrame(gameLoop);

        let dt = (timestamp - lastTime) / 1000;
        lastTime = timestamp;

        // Clamp dt to avoid huge jumps
        if (dt > MAX_DT) dt = MAX_DT;
        if (dt <= 0) dt = 0.016;

        update(dt);
        render();
    }

    function update(dt) {
        // Update shake (always)
        updateShake(dt);

        // Update clouds (always for ambiance)
        updateClouds(dt);

        // If paused, only update ambiance (clouds, shake, particles)
        if (gameState === STATE.PAUSED) {
            updateCelebrationParticles(dt);
            return;
        }

        // Update bird
        bird.update(dt);

        // Update pipes
        updatePipes(dt);

        // Check collisions and scoring (only when playing)
        if (gameState === STATE.PLAYING) {
            for (const pipe of pipes) {
                if (checkCollision(pipe)) {
                    triggerDeath();
                    break;
                }
                checkScoring(pipe);
            }

            // Check if bird hit the ground
            const groundY = canvasHeight - groundHeight;
            if (bird.y + birdRadius >= groundY) {
                bird.y = groundY - birdRadius;
                triggerDeath();
            }
        }

        // Update celebration particles
        updateCelebrationParticles(dt);

        // Update score pop animation
        if (scorePopTimer > 0) {
            scorePopTimer -= dt;
            scorePopScale = 1 + (scorePopTimer / 0.35) * 0.5;
            if (scorePopTimer <= 0) {
                scorePopScale = 1;
            }
        }
    }

    function render() {
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        const shake = getShakeOffset();

        ctx.save();
        ctx.translate(shake.x, shake.y);

        // Draw sky
        drawSky();

        // Draw clouds behind everything
        drawClouds();

        // Draw pipes
        for (const pipe of pipes) {
            drawPipe(pipe);
        }

        // Draw ground
        drawGround();

        // Draw celebration particles (behind bird)
        drawCelebrationParticles();

        // Draw bird
        drawBird();

        // Draw dying flash
        drawDyingFlash();

        ctx.restore();

        // UI elements (not affected by shake)
        if (gameState === STATE.PLAYING || gameState === STATE.DYING) {
            drawScore();
        }

        if (gameState === STATE.IDLE) {
            drawIdleUI();
        }

        if (gameState === STATE.GAMEOVER) {
            drawScore();
            drawGameOverUI();
        }

        if (gameState === STATE.PAUSED) {
            drawScore(); // show score during pause
            drawPauseOverlay();
        }

        // Mute button always visible
        drawMuteButton();
    }

    // ─────────────────────────────────────
    // INPUT HANDLING
    // ─────────────────────────────────────
    function isInsideMuteButton(x, y) {
        return x >= muteBtnX - muteBtnSize/2 && x <= muteBtnX + muteBtnSize/2 &&
               y >= muteBtnY - muteBtnSize/2 && y <= muteBtnY + muteBtnSize/2;
    }

    function handleInput(e) {
        e.preventDefault();

        // Determine coordinates
        let clientX, clientY;
        if (e.touches) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        const rect = canvas.getBoundingClientRect();
        const canvasX = clientX - rect.left;
        const canvasY = clientY - rect.top;

        // Toggle mute if tap on speaker icon
        if (isInsideMuteButton(canvasX, canvasY)) {
            isMuted = !isMuted;
            if (masterGain) masterGain.gain.value = isMuted ? 0 : 1.0;
            return;
        }

        initAudio();

        switch (gameState) {
            case STATE.IDLE:
                // Start the game
                gameState = STATE.PLAYING;
                bird.reset();
                resetPipes();
                score = 0;
                scorePopScale = 1;
                scorePopTimer = 0;
                celebrationParticles = [];
                bird.flap();
                // Spawn first pipe soon
                pipeTimer = pipeSpawnInterval * 0.55;
                break;

            case STATE.PLAYING:
                bird.flap();
                break;

            case STATE.PAUSED:
                // Resume game
                gameState = STATE.PLAYING;
                break;

            case STATE.GAMEOVER:
                // Restart
                gameState = STATE.IDLE;
                bird.reset();
                resetPipes();
                score = 0;
                scorePopScale = 1;
                scorePopTimer = 0;
                celebrationParticles = [];
                shakeAmount = 0;
                shakeDuration = 0;
                break;

            case STATE.DYING:
                // Ignore input during death animation
                break;
        }
    }

    // Touch events
    canvas.addEventListener('touchstart', function (e) {
        e.preventDefault();
        handleInput(e);
    }, { passive: false });

    // Mouse events (for desktop debugging)
    canvas.addEventListener('mousedown', function (e) {
        e.preventDefault();
        handleInput(e);
    });

    // Prevent context menu on long press
    canvas.addEventListener('contextmenu', function (e) {
        e.preventDefault();
    });

    // ─────────────────────────────────────
    // AUTO-PAUSE ON VISIBILITY CHANGE
    // ─────────────────────────────────────
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (gameState === STATE.PLAYING) {
                gameState = STATE.PAUSED;
            }
        }
        // When becoming visible we stay paused, user must tap to resume
    });

    // ─────────────────────────────────────
    // RESIZE HANDLING
    // ─────────────────────────────────────
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            const oldWidth = canvasWidth;
            const oldHeight = canvasHeight;
            updateDimensions();
            applyDifficulty();

            // Adjust bird position proportionally
            bird.x = canvasWidth * (bird.x / oldWidth);
            bird.y = Math.min(bird.y, canvasHeight - groundHeight - birdRadius);
            bird.y = Math.max(bird.y, birdRadius);

            // Adjust pipes
            for (const pipe of pipes) {
                pipe.x = canvasWidth * (pipe.x / oldWidth);
                pipe.topHeight = canvasHeight * (pipe.topHeight / oldHeight);
                pipe.bottomY = canvasHeight * (pipe.bottomY / oldHeight);
            }

            // Reinitialize clouds
            initClouds();

            // Reset pipe timer
            pipeTimer = pipeSpawnInterval * 0.5;
        }, 300);
    });

    // Handle orientation change
    window.addEventListener('orientationchange', () => {
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 400);
    });

    // ─────────────────────────────────────
    // INITIALIZATION
    // ─────────────────────────────────────
    function init() {
        updateDimensions();
        applyDifficulty();
        bird.reset();
        resetPipes();
        initClouds();
        score = 0;
        scorePopScale = 1;
        scorePopTimer = 0;
        celebrationParticles = [];
        gameState = STATE.IDLE;
        shakeAmount = 0;
        shakeDuration = 0;
        lastTime = performance.now();

        // Load best score
        try {
            const saved = localStorage.getItem('flappyBirdBestScore');
            if (saved !== null) bestScore = parseInt(saved, 10) || 0;
        } catch (e) {
            bestScore = 0;
        }

        // Mute button dimensions (set after updateDimensions)
        muteBtnSize = 26 * scale;
        muteBtnX = canvasWidth - 45 * scale;
        muteBtnY = 35 * scale;
    }

    init();

    // Start game loop
    requestAnimationFrame(gameLoop);

    // ─────────────────────────────────────
    // ROUNDRECT POLYFILL (if needed)
    // ─────────────────────────────────────
    if (!ctx.roundRect) {
        ctx.roundRect = function (x, y, w, h, r) {
            if (typeof r === 'number') r = { tl: r, tr: r, br: r, bl: r };
            ctx.beginPath();
            ctx.moveTo(x + r.tl, y);
            ctx.lineTo(x + w - r.tr, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + r.tr);
            ctx.lineTo(x + w, y + h - r.br);
            ctx.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
            ctx.lineTo(x + r.bl, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - r.bl);
            ctx.lineTo(x, y + r.tl);
            ctx.quadraticCurveTo(x, y, x + r.tl, y);
            ctx.closePath();
        };
    }

    console.log('🐦 Flappy Bird ready! Tap to play.');
    console.log('📱 Optimized for mobile with enhanced audio.');
    console.log('🎨 Enhanced visuals & physics engine active.');
    console.log('🌓 Day/night cycle, dynamic difficulty, mute, and auto-pause enabled.');
})();