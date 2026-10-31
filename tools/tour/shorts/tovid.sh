#!/bin/bash
# tovid.sh TAKE K -> TAKE/take.mp4 (page-time, 60fps CFR)
T=$1; K=$2
ffmpeg -y -loglevel error -f concat -safe 0 -i $T/frames/list.txt -vf "setpts=PTS/$K,fps=60,format=yuv420p" -c:v libx264 -preset fast -crf 12 $T/take.mp4
ffprobe -v error -show_entries stream=width,height:format=duration -of csv=p=0 $T/take.mp4
