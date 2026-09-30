#!/bin/sh
# prof.sh FILE [WIN_S=5] — per-window RMS/peak (dBFS) to find steady, clean stretches;
# spectrogram PNG next to it (FILE.png) to eyeball content (birds = chirps 2-8 kHz, waves = broadband swells, engine = harmonic lines < 1 kHz)
W=${2:-5}
ffmpeg -v error -i "$1" -ac 1 -ar 8000 -f f32le - | python3 -c "
import sys,numpy as np; y=np.frombuffer(sys.stdin.buffer.read(),np.float32); W=int($W*8000)
print(' '.join(f'{i*$W}s:{20*np.log10(np.sqrt((y[i*W:(i+1)*W]**2).mean())+1e-9):.0f}/{20*np.log10(abs(y[i*W:(i+1)*W]).max()+1e-9):.0f}' for i in range(len(y)//W)))"
ffmpeg -v error -y -i "$1" -lavfi showspectrumpic=s=1200x400:legend=1:fscale=log "$1.png"
