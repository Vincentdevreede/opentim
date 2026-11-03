/** Complete signed quotient helper, including its return-frame bridge. */
export const divisionPatterns = [
  `pop cx
push cs
push cx
xor cx,cx
jmp @labelF
labelF: push bp
push si
push di
mov bp,sp
mov di,cx
mov ax,16:ss[bp+10]
mov dx,16:ss[bp+12]
mov bx,16:ss[bp+14]
mov cx,16:ss[bp+16]
or cx,cx
jne @labelU
or dx,dx
je @labelBP
or bx,bx
je @labelBP
labelU: test di,#1
jne @labelAI
or dx,dx
jns @labelAC
neg dx
neg ax
sbb dx,#0
or di,#12
labelAC: or cx,cx
jns @labelAI
neg cx
neg bx
sbb cx,#0
xor di,#4
labelAI: mov bp,cx
mov cx,#32
push di
xor di,di
xor si,si
labelAN: shl ax,#1
rcl dx,#1
rcl si,#1
rcl di,#1
cmp di,bp
jb @labelAZ
ja @labelAW
cmp si,bx
jb @labelAZ
labelAW: sub si,bx
sbb di,bp
inc ax
labelAZ: loop @labelAN
pop bx
test bx,#2
je @labelBG
mov ax,si
mov dx,di
shr bx,#1
labelBG: test bx,#4
je @labelBL
neg dx
neg ax
sbb dx,#0
labelBL: pop di
pop si
pop bp
retf #8
labelBP: div bx
test di,#2
je @labelBT
xchg ax,dx
labelBT: xor dx,dx
jmp @labelBL`,
  `xor cx,cx
jmp @labelC
labelC: push bp
push si
push di
mov bp,sp
mov di,cx
mov ax,16:ss[bp+10]
mov dx,16:ss[bp+12]
mov bx,16:ss[bp+14]
mov cx,16:ss[bp+16]
or cx,cx
jne @labelR
or dx,dx
je @labelBM
or bx,bx
je @labelBM
labelR: test di,#1
jne @labelAF
or dx,dx
jns @labelZ
neg dx
neg ax
sbb dx,#0
or di,#12
labelZ: or cx,cx
jns @labelAF
neg cx
neg bx
sbb cx,#0
xor di,#4
labelAF: mov bp,cx
mov cx,#32
push di
xor di,di
xor si,si
labelAK: shl ax,#1
rcl dx,#1
rcl si,#1
rcl di,#1
cmp di,bp
jb @labelAW
ja @labelAT
cmp si,bx
jb @labelAW
labelAT: sub si,bx
sbb di,bp
inc ax
labelAW: loop @labelAK
pop bx
test bx,#2
je @labelBD
mov ax,si
mov dx,di
shr bx,#1
labelBD: test bx,#4
je @labelBI
neg dx
neg ax
sbb dx,#0
labelBI: pop di
pop si
pop bp
retf #8
labelBM: div bx
test di,#2
je @labelBQ
xchg ax,dx
labelBQ: xor dx,dx
jmp @labelBI`,
];
