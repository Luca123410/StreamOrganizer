// ⚡ CYBER NEXUS - CYBERPUNK EPIC FINAL LIGHT PURPLE
(function initCyberFinalLight() {
    const canvas = document.getElementById('bgCanvas');
    if (window.innerWidth <= 960) return; // Disattiva l'animazione JS su mobile
    const ctx = canvas.getContext('2d', {alpha:true});

    let w = canvas.width = innerWidth;
    let h = canvas.height = innerHeight;
    let tStart = performance.now();
    let mouse = {x:w/2, y:h/2};

    const layers = [
        {amp:50, wave:0.007, speed:0.0015, hue:270, alpha:0.28, thick:1.5}, // viola/fucsia
        {amp:80, wave:0.005, speed:0.0008, hue:200, alpha:0.25, thick:2},  // ciano
        {amp:30, wave:0.01, speed:0.0018, hue:320, alpha:0.2, thick:1.6},  // fucsia
        {amp:160, wave:0.004, speed:0.0003, hue:180, alpha:0.15, thick:2.5} // turchese
    ];

    const gridLines = Array.from({length: 35}, () => ({
        x: Math.random()*w, y: Math.random()*h,
        len: 100+Math.random()*200,
        speed: 0.4 + Math.random()*0.6,
        alpha: 0.05+Math.random()*0.1
    }));

    const particles = Array.from({length:150},() => ({
        x: Math.random()*w,
        y: Math.random()*h,
        r: Math.random()*1.2+0.2,
        speed: 0.1 + Math.random()*0.3,
        alpha: 0.1 + Math.random()*0.25
    }));

    function resize(){ w=canvas.width=innerWidth; h=canvas.height=innerHeight; }
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', e => { mouse.x=e.clientX; mouse.y=e.clientY; });

    window.addEventListener('click', ()=>{
        const pulse={r:0,max:Math.min(w,h)*0.8,alpha:0.4};
        const anim=()=>{
            pulse.r+=30;
            pulse.alpha*=0.88;
            ctx.beginPath();
            ctx.arc(mouse.x, mouse.y, pulse.r,0,Math.PI*2);
            ctx.strokeStyle=`rgba(255,255,255,${pulse.alpha})`;
            ctx.lineWidth=3;
            ctx.stroke();
            if(pulse.alpha>0.01) requestAnimationFrame(anim);
        };
        anim();
    });

    function draw(t){
        const time=t-tStart;

        // Sfondo cyberpunk bilanciato
        const g=ctx.createLinearGradient(0,0,w,h);
        g.addColorStop(0,'rgba(35,10,45,1)'); 
        g.addColorStop(0.5,'rgba(20,15,40,1)'); 
        g.addColorStop(1,'rgba(15,10,30,1)');
        ctx.fillStyle=g;
        ctx.fillRect(0,0,w,h);

        // Respiro centrale attenuato
        const pulseScale = 0.4 + Math.sin(time*0.001)*0.15; // meno invasivo
        const vg=ctx.createRadialGradient(w/2,h/2,0,w/2,h/2,Math.max(w,h)*0.4*pulseScale);
        vg.addColorStop(0,'rgba(200,100,255,0.05)'); // più leggero
        vg.addColorStop(1,'rgba(15,10,30,0.85)');
        ctx.fillStyle=vg;
        ctx.fillRect(0,0,w,h);

        ctx.globalCompositeOperation='lighter';

        // Reticolo digitale leggermente 3D
        gridLines.forEach(l=>{
            ctx.beginPath();
            ctx.strokeStyle=`rgba(0,255,255,${l.alpha})`;
            ctx.moveTo(l.x,l.y);
            ctx.lineTo(l.x+Math.sin(time*0.001+l.x/100)*20,l.y+l.len);
            ctx.lineWidth=1;
            ctx.stroke();
            l.y+=l.speed;
            if(l.y>h){ l.y=-l.len; l.x=Math.random()*w; }
        });

        // Onde neon con glitch e vibrate
        layers.forEach((L,idx)=>{
            ctx.beginPath();
            const grad=ctx.createLinearGradient(0,0,w,0);
            grad.addColorStop(0,`hsla(${L.hue},100%,60%,${L.alpha})`);
            grad.addColorStop(1,`hsla(${(L.hue+20)%360},80%,55%,${L.alpha})`);
            ctx.strokeStyle=grad;
            ctx.lineWidth=L.thick;
            const step=Math.max(2,Math.round(w/200));
            for(let x=0;x<=w;x+=step){
                let wave = Math.sin(x/(L.wave*w)*2*Math.PI + time*L.speed)*L.amp +
                           Math.sin(x*0.02+time*L.speed*5)*(L.amp*0.1);
                if(Math.random()<0.003) wave += (Math.random()-0.5)*50;
                const vibrate = (Math.random()-0.5)*2;
                const dist = Math.hypot(x-mouse.x,h/2-mouse.y);
                const m = 1-Math.min(dist/(w*0.8),1);
                const y = h*0.5 + wave*(0.8+m*0.4) + vibrate;
                if(x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
            }
            ctx.stroke();
        });

        // Particelle fluttuanti con flash interattivi
        particles.forEach(p=>{
            ctx.beginPath();
            let alpha = p.alpha;
            const d = Math.hypot(p.x-mouse.x,p.y-mouse.y);
            if(d<100) alpha += (100-d)/300;
            ctx.fillStyle=`rgba(255,200,255,${alpha})`;
            ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
            ctx.fill();
            p.y -= p.speed;
            if(p.y<-5){ p.y=h+5; p.x=Math.random()*w; }
        });

        // Vapore di luce leggero
        for(let i=0;i<3;i++){
            ctx.beginPath();
            const x = w*0.5 + Math.sin(time*0.0005+i)*w*0.15;
            const y = h*0.5 + Math.cos(time*0.0003+i)*h*0.1;
            const rad = 60 + Math.sin(time*0.001+i)*40;
            const grd=ctx.createRadialGradient(x,y,0,x,y,rad);
            grd.addColorStop(0,`rgba(180,100,255,0.02)`);
            grd.addColorStop(1,'rgba(0,0,0,0)');
            ctx.fillStyle=grd;
            ctx.fillRect(0,0,w,h);
        }

        // Scanlines leggere
        ctx.globalCompositeOperation='overlay';
        ctx.fillStyle='rgba(255,255,255,0.03)';
        for(let y=0;y<h;y+=4) ctx.fillRect(0,y,w,1);

        ctx.globalCompositeOperation='source-over';
        requestAnimationFrame(draw);
    }

    resize();
    requestAnimationFrame(draw);
})();
