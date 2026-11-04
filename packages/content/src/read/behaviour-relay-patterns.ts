/** Instruction-graph patterns of the rope, belt and relay helpers, one per compiler form found in the supplied builds. */

/** Complete compiler forms of the rope geometry update: rope ends, pulley records and the rope's end words. */
export const ropeGeometryPatterns = [
  `push bp
mov bp,sp
sub sp,#8
push si
push di
mov di,16:ss[bp+6]
mov ax,16:ds[di+2]
mov si,ax
or ax,ax
jne @LA
jmp @LH
LA: mov al,8:ds[di+10]
mov ah,#0
mov 16:ss[bp+-2],ax
mov bx,16:ss[bp+-2]
shl bx,#1
mov al,8:ds[bx+si+106]
mov ah,#0
mov dx,16:ds[si+42]
add dx,ax
mov 16:ds[di+20],dx
mov bx,16:ss[bp+-2]
shl bx,#1
mov al,8:ds[bx+si+107]
mov ah,#0
mov dx,16:ds[si+44]
add dx,ax
mov 16:ds[di+22],dx
mov ax,16:ds[di+4]
mov 16:ss[bp+-8],ax
or ax,ax
je @LB
mov al,8:ds[di+11]
mov ah,#0
mov 16:ss[bp+-4],ax
shl ax,#1
mov bx,16:ss[bp+-8]
add bx,ax
mov al,8:ds[bx+106]
mov ah,#0
mov bx,16:ss[bp+-8]
mov dx,16:ds[bx+42]
add dx,ax
mov 16:ds[di+24],dx
mov ax,16:ss[bp+-4]
shl ax,#1
add bx,ax
mov al,8:ds[bx+107]
mov ah,#0
mov bx,16:ss[bp+-8]
mov dx,16:ds[bx+44]
add dx,ax
mov 16:ds[di+26],dx
LB: mov bx,16:ss[bp+-2]
shl bx,#1
mov si,16:ds[bx+si+90]
jmp @LF
LC: mov 16:ss[bp+-6],#0
jmp @LE
LD: mov bx,16:ss[bp+-6]
shl bx,#1
mov al,8:ds[bx+si+106]
mov ah,#0
mov dx,16:ds[si+30]
add dx,ax
mov ax,16:ss[bp+-6]
shl ax,#1
shl ax,#1
mov bx,16:ds[si+102]
add bx,ax
mov 16:ds[bx+20],dx
mov bx,16:ss[bp+-6]
shl bx,#1
mov al,8:ds[bx+si+107]
mov ah,#0
mov dx,16:ds[si+32]
add dx,ax
mov ax,16:ss[bp+-6]
shl ax,#1
shl ax,#1
mov bx,16:ds[si+102]
add bx,ax
mov 16:ds[bx+22],dx
inc 16:ss[bp+-6]
LE: cmp 16:ss[bp+-6],#2
jl @LD
mov si,16:ds[si+90]
LF: or si,si
je @LG
cmp 16:ds[si+4],#7
je @LC
LG: cmp 16:ds[{gA}],#8192
je @LH
xor ax,ax
push ax
mov ax,#3
push ax
push di
nop
push cs
call $ropePoint
add sp,#6
mov bx,16:ds[di+0]
mov 16:ds[bx+150],ax
mov ax,#1
push ax
mov ax,#3
push ax
push di
nop
push cs
call $ropePoint
add sp,#6
mov bx,16:ds[di+0]
mov 16:ds[bx+156],ax
LH: pop di
pop si
mov sp,bp
pop bp
retf`,
  `push bp
mov bp,sp
sub sp,#8
push si
push di
mov di,16:ss[bp+6]
mov ax,16:ds[di+2]
mov si,ax
or ax,ax
jne @LA
jmp @LH
LA: mov al,8:ds[di+10]
mov ah,#0
mov 16:ss[bp+-2],ax
mov bx,16:ss[bp+-2]
shl bx,#1
mov al,8:ds[bx+si+106]
mov ah,#0
mov dx,16:ds[si+42]
add dx,ax
mov 16:ds[di+20],dx
mov bx,16:ss[bp+-2]
shl bx,#1
mov al,8:ds[bx+si+107]
mov ah,#0
mov dx,16:ds[si+44]
add dx,ax
mov 16:ds[di+22],dx
mov ax,16:ds[di+4]
mov 16:ss[bp+-8],ax
or ax,ax
je @LB
mov al,8:ds[di+11]
mov ah,#0
mov 16:ss[bp+-4],ax
mov ax,16:ss[bp+-4]
shl ax,#1
mov bx,16:ss[bp+-8]
add bx,ax
mov al,8:ds[bx+106]
mov ah,#0
mov bx,16:ss[bp+-8]
mov dx,16:ds[bx+42]
add dx,ax
mov 16:ds[di+24],dx
mov ax,16:ss[bp+-4]
shl ax,#1
mov bx,16:ss[bp+-8]
add bx,ax
mov al,8:ds[bx+107]
mov ah,#0
mov bx,16:ss[bp+-8]
mov dx,16:ds[bx+44]
add dx,ax
mov 16:ds[di+26],dx
LB: mov bx,16:ss[bp+-2]
shl bx,#1
mov si,16:ds[bx+si+90]
jmp @LF
LC: mov 16:ss[bp+-6],#0
jmp @LE
LD: mov bx,16:ss[bp+-6]
shl bx,#1
mov al,8:ds[bx+si+106]
mov ah,#0
mov dx,16:ds[si+30]
add dx,ax
mov ax,16:ss[bp+-6]
shl ax,#1
shl ax,#1
mov bx,16:ds[si+102]
add bx,ax
mov 16:ds[bx+20],dx
mov bx,16:ss[bp+-6]
shl bx,#1
mov al,8:ds[bx+si+107]
mov ah,#0
mov dx,16:ds[si+32]
add dx,ax
mov ax,16:ss[bp+-6]
shl ax,#1
shl ax,#1
mov bx,16:ds[si+102]
add bx,ax
mov 16:ds[bx+22],dx
inc 16:ss[bp+-6]
LE: cmp 16:ss[bp+-6],#2
jl @LD
mov si,16:ds[si+90]
LF: or si,si
je @LG
cmp 16:ds[si+4],#7
je @LC
LG: cmp 16:ds[{gA}],#8192
je @LH
xor ax,ax
push ax
mov ax,#3
push ax
push di
nop
push cs
call $ropePoint
add sp,#6
mov bx,16:ds[di+0]
mov 16:ds[bx+150],ax
mov ax,#1
push ax
mov ax,#3
push ax
push di
nop
push cs
call $ropePoint
add sp,#6
mov bx,16:ds[di+0]
mov 16:ds[bx+156],ax
LH: pop di
pop si
mov sp,bp
pop bp
retf`,
  `push bp
mov bp,sp
sub sp,#8
push si
push di
mov di,16:ss[bp+6]
mov ax,16:ds[di+2]
mov si,ax
or ax,ax
jne @LA
jmp @LH
LA: mov al,8:ds[di+10]
mov ah,#0
mov 16:ss[bp+-2],ax
mov bx,16:ss[bp+-2]
shl bx,#1
mov al,8:ds[bx+si+106]
mov ah,#0
mov dx,16:ds[si+42]
add dx,ax
mov 16:ds[di+20],dx
mov bx,16:ss[bp+-2]
shl bx,#1
mov al,8:ds[bx+si+107]
mov ah,#0
mov dx,16:ds[si+44]
add dx,ax
mov 16:ds[di+22],dx
mov ax,16:ds[di+4]
mov 16:ss[bp+-8],ax
or ax,ax
je @LB
mov al,8:ds[di+11]
mov ah,#0
mov 16:ss[bp+-4],ax
shl ax,#1
mov bx,16:ss[bp+-8]
add bx,ax
mov al,8:ds[bx+106]
mov ah,#0
mov bx,16:ss[bp+-8]
mov dx,16:ds[bx+42]
add dx,ax
mov 16:ds[di+24],dx
mov ax,16:ss[bp+-4]
shl ax,#1
add bx,ax
mov al,8:ds[bx+107]
mov ah,#0
mov bx,16:ss[bp+-8]
mov dx,16:ds[bx+44]
add dx,ax
mov 16:ds[di+26],dx
LB: mov bx,16:ss[bp+-2]
shl bx,#1
mov si,16:ds[bx+si+90]
jmp @LF
LC: mov 16:ss[bp+-6],#0
jmp @LE
LD: mov bx,16:ss[bp+-6]
shl bx,#1
mov al,8:ds[bx+si+106]
mov ah,#0
mov dx,16:ds[si+30]
add dx,ax
mov ax,16:ss[bp+-6]
mov cl,#2
shl ax,cl
mov bx,16:ds[si+102]
add bx,ax
mov 16:ds[bx+20],dx
mov bx,16:ss[bp+-6]
shl bx,#1
mov al,8:ds[bx+si+107]
mov ah,#0
mov dx,16:ds[si+32]
add dx,ax
mov ax,16:ss[bp+-6]
shl ax,cl
mov bx,16:ds[si+102]
add bx,ax
mov 16:ds[bx+22],dx
inc 16:ss[bp+-6]
LE: cmp 16:ss[bp+-6],#2
jl @LD
mov si,16:ds[si+90]
LF: or si,si
je @LG
cmp 16:ds[si+4],#7
je @LC
LG: cmp 16:ds[{gA}],#8192
je @LH
xor ax,ax
push ax
mov ax,#3
push ax
push di
nop
push cs
call $ropePoint
add sp,#6
mov bx,16:ds[di+0]
mov 16:ds[bx+150],ax
mov ax,#1
push ax
mov ax,#3
push ax
push di
nop
push cs
call $ropePoint
add sp,#6
mov bx,16:ds[di+0]
mov 16:ds[bx+156],ax
LH: pop di
pop si
mov sp,bp
pop bp
retf`,
  `push bp
mov bp,sp
sub sp,#8
push si
push di
mov di,16:ss[bp+6]
mov ax,16:ds[di+2]
mov si,ax
or ax,ax
jne @LA
jmp @LH
LA: mov al,8:ds[di+10]
mov ah,#0
mov 16:ss[bp+-2],ax
mov bx,16:ss[bp+-2]
shl bx,#1
mov al,8:ds[bx+si+106]
mov ah,#0
mov dx,16:ds[si+42]
add dx,ax
mov 16:ds[di+20],dx
mov bx,16:ss[bp+-2]
shl bx,#1
mov al,8:ds[bx+si+107]
mov ah,#0
mov dx,16:ds[si+44]
add dx,ax
mov 16:ds[di+22],dx
mov ax,16:ds[di+4]
mov 16:ss[bp+-8],ax
or ax,ax
je @LB
mov al,8:ds[di+11]
mov ah,#0
mov 16:ss[bp+-4],ax
mov ax,16:ss[bp+-4]
shl ax,#1
mov bx,16:ss[bp+-8]
add bx,ax
mov al,8:ds[bx+106]
mov ah,#0
mov bx,16:ss[bp+-8]
mov dx,16:ds[bx+42]
add dx,ax
mov 16:ds[di+24],dx
mov ax,16:ss[bp+-4]
shl ax,#1
mov bx,16:ss[bp+-8]
add bx,ax
mov al,8:ds[bx+107]
mov ah,#0
mov bx,16:ss[bp+-8]
mov dx,16:ds[bx+44]
add dx,ax
mov 16:ds[di+26],dx
LB: mov bx,16:ss[bp+-2]
shl bx,#1
mov si,16:ds[bx+si+90]
jmp @LF
LC: mov 16:ss[bp+-6],#0
jmp @LE
LD: mov bx,16:ss[bp+-6]
shl bx,#1
mov al,8:ds[bx+si+106]
mov ah,#0
mov dx,16:ds[si+30]
add dx,ax
mov ax,16:ss[bp+-6]
mov cl,#2
shl ax,cl
mov bx,16:ds[si+102]
add bx,ax
mov 16:ds[bx+20],dx
mov bx,16:ss[bp+-6]
shl bx,#1
mov al,8:ds[bx+si+107]
mov ah,#0
mov dx,16:ds[si+32]
add dx,ax
mov ax,16:ss[bp+-6]
mov cl,#2
shl ax,cl
mov bx,16:ds[si+102]
add bx,ax
mov 16:ds[bx+22],dx
inc 16:ss[bp+-6]
LE: cmp 16:ss[bp+-6],#2
jl @LD
mov si,16:ds[si+90]
LF: or si,si
je @LG
cmp 16:ds[si+4],#7
je @LC
LG: cmp 16:ds[{gA}],#8192
je @LH
xor ax,ax
push ax
mov ax,#3
push ax
push di
nop
push cs
call $ropePoint
add sp,#6
mov bx,16:ds[di+0]
mov 16:ds[bx+150],ax
mov ax,#1
push ax
mov ax,#3
push ax
push di
nop
push cs
call $ropePoint
add sp,#6
mov bx,16:ds[di+0]
mov 16:ds[bx+156],ax
LH: pop di
pop si
mov sp,bp
pop bp
retf`,
];

/** Complete compiler forms of the rope reversal: the pulley chain's links and records, then the rope's own ends. */
export const ropeReversePatterns = [
  `push bp
mov bp,sp
sub sp,#8
push si
push di
mov bx,16:ss[bp+6]
mov al,8:ds[bx+10]
mov ah,#0
shl ax,#1
mov bx,16:ds[bx+2]
add bx,ax
mov di,16:ds[bx+90]
jmp @LB
LA: mov ax,16:ds[di+90]
mov 16:ss[bp+-8],ax
mov ax,16:ds[di+92]
mov 16:ds[di+90],ax
mov ax,16:ss[bp+-8]
mov 16:ds[di+92],ax
mov ax,16:ds[di+90]
mov 16:ds[di+94],ax
mov ax,16:ds[di+92]
mov 16:ds[di+96],ax
mov ax,16:ds[di+106]
mov 16:ss[bp+-6],ax
mov ax,16:ds[di+108]
mov 16:ds[di+106],ax
mov ax,16:ss[bp+-6]
mov 16:ds[di+108],ax
mov si,16:ds[di+102]
mov ax,16:ds[si+20]
mov 16:ss[bp+-4],ax
mov ax,16:ds[si+24]
mov 16:ds[si+20],ax
mov ax,16:ss[bp+-4]
mov 16:ds[si+24],ax
mov ax,16:ds[si+22]
mov 16:ss[bp+-4],ax
mov ax,16:ds[si+26]
mov 16:ds[si+22],ax
mov ax,16:ss[bp+-4]
mov 16:ds[si+26],ax
mov ax,16:ds[si+28]
mov 16:ss[bp+-4],ax
mov ax,16:ds[si+32]
mov 16:ds[si+28],ax
mov ax,16:ss[bp+-4]
mov 16:ds[si+32],ax
mov ax,16:ds[si+30]
mov 16:ss[bp+-4],ax
mov ax,16:ds[si+34]
mov 16:ds[si+30],ax
mov ax,16:ss[bp+-4]
mov 16:ds[si+34],ax
mov ax,16:ds[si+36]
mov 16:ss[bp+-4],ax
mov ax,16:ds[si+40]
mov 16:ds[si+36],ax
mov ax,16:ss[bp+-4]
mov 16:ds[si+40],ax
mov ax,16:ds[si+38]
mov 16:ss[bp+-4],ax
mov ax,16:ds[si+42]
mov 16:ds[si+38],ax
mov ax,16:ss[bp+-4]
mov 16:ds[si+42],ax
mov di,16:ds[di+92]
LB: or di,di
je @LC
cmp 16:ds[di+4],#7
jne @LC
jmp @LA
LC: mov bx,16:ss[bp+6]
mov ax,16:ds[bx+2]
mov 16:ss[bp+-8],ax
mov ax,16:ds[bx+4]
mov 16:ds[bx+2],ax
mov 16:ds[bx+6],ax
mov ax,16:ss[bp+-8]
mov 16:ds[bx+4],ax
mov 16:ds[bx+8],ax
mov al,8:ds[bx+10]
mov 8:ss[bp+-1],al
mov al,8:ds[bx+11]
mov 8:ds[bx+10],al
mov 8:ds[bx+12],al
mov al,8:ss[bp+-1]
mov 8:ds[bx+11],al
mov 8:ds[bx+13],al
mov ax,#3
push ax
push 16:ds[bx+0]
nop
push cs
call $notify
pop cx
pop cx
pop di
pop si
mov sp,bp
pop bp
retf`,
  `push bp
mov bp,sp
sub sp,#8
push si
push di
mov bx,16:ss[bp+6]
mov al,8:ds[bx+10]
mov ah,#0
shl ax,#1
mov bx,16:ss[bp+6]
mov bx,16:ds[bx+2]
add bx,ax
mov di,16:ds[bx+90]
jmp @LB
LA: mov ax,16:ds[di+90]
mov 16:ss[bp+-8],ax
mov ax,16:ds[di+92]
mov 16:ds[di+90],ax
mov ax,16:ss[bp+-8]
mov 16:ds[di+92],ax
mov ax,16:ds[di+90]
mov 16:ds[di+94],ax
mov ax,16:ds[di+92]
mov 16:ds[di+96],ax
mov ax,16:ds[di+106]
mov 16:ss[bp+-6],ax
mov ax,16:ds[di+108]
mov 16:ds[di+106],ax
mov ax,16:ss[bp+-6]
mov 16:ds[di+108],ax
mov si,16:ds[di+102]
mov ax,16:ds[si+20]
mov 16:ss[bp+-4],ax
mov ax,16:ds[si+24]
mov 16:ds[si+20],ax
mov ax,16:ss[bp+-4]
mov 16:ds[si+24],ax
mov ax,16:ds[si+22]
mov 16:ss[bp+-4],ax
mov ax,16:ds[si+26]
mov 16:ds[si+22],ax
mov ax,16:ss[bp+-4]
mov 16:ds[si+26],ax
mov ax,16:ds[si+28]
mov 16:ss[bp+-4],ax
mov ax,16:ds[si+32]
mov 16:ds[si+28],ax
mov ax,16:ss[bp+-4]
mov 16:ds[si+32],ax
mov ax,16:ds[si+30]
mov 16:ss[bp+-4],ax
mov ax,16:ds[si+34]
mov 16:ds[si+30],ax
mov ax,16:ss[bp+-4]
mov 16:ds[si+34],ax
mov ax,16:ds[si+36]
mov 16:ss[bp+-4],ax
mov ax,16:ds[si+40]
mov 16:ds[si+36],ax
mov ax,16:ss[bp+-4]
mov 16:ds[si+40],ax
mov ax,16:ds[si+38]
mov 16:ss[bp+-4],ax
mov ax,16:ds[si+42]
mov 16:ds[si+38],ax
mov ax,16:ss[bp+-4]
mov 16:ds[si+42],ax
mov di,16:ds[di+92]
LB: or di,di
je @LC
cmp 16:ds[di+4],#7
jne @LC
jmp @LA
LC: mov bx,16:ss[bp+6]
mov ax,16:ds[bx+2]
mov 16:ss[bp+-8],ax
mov bx,16:ss[bp+6]
mov ax,16:ds[bx+4]
mov bx,16:ss[bp+6]
mov 16:ds[bx+2],ax
mov bx,16:ss[bp+6]
mov 16:ds[bx+6],ax
mov bx,16:ss[bp+6]
mov ax,16:ss[bp+-8]
mov 16:ds[bx+4],ax
mov bx,16:ss[bp+6]
mov 16:ds[bx+8],ax
mov bx,16:ss[bp+6]
mov al,8:ds[bx+10]
mov 8:ss[bp+-1],al
mov bx,16:ss[bp+6]
mov al,8:ds[bx+11]
mov bx,16:ss[bp+6]
mov 8:ds[bx+10],al
mov bx,16:ss[bp+6]
mov 8:ds[bx+12],al
mov bx,16:ss[bp+6]
mov al,8:ss[bp+-1]
mov 8:ds[bx+11],al
mov bx,16:ss[bp+6]
mov 8:ds[bx+13],al
mov ax,#3
push ax
mov bx,16:ss[bp+6]
push 16:ds[bx+0]
nop
push cs
call $notify
pop cx
pop cx
pop di
pop si
mov sp,bp
pop bp
retf`,
];

/** Complete compiler forms of the part hit test that can swap a belt's ends or reverse a rope. */
export const hitTestPatterns = [
  `push bp
mov bp,sp
sub sp,#34
push si
push di
mov si,16:ss[bp+8]
mov ax,16:ds[{gA}]
mov 16:ss[bp+-2],ax
mov 16:ss[bp+-6],ax
mov ax,16:ds[{gB}]
mov 16:ss[bp+-4],ax
mov 16:ss[bp+-8],ax
mov ax,16:ds[si+42]
sub ax,16:ds[{gC}]
mov 16:ss[bp+-20],ax
mov ax,16:ds[si+44]
sub ax,16:ds[{gD}]
mov 16:ss[bp+-18],ax
mov ax,16:ss[bp+-20]
mov 16:ss[bp+-10],ax
mov di,16:ss[bp+-18]
add ax,16:ds[si+68]
mov 16:ss[bp+-12],ax
mov ax,di
add ax,16:ds[si+70]
mov 16:ss[bp+-14],ax
mov ax,16:ds[si+84]
mov 16:ss[bp+-22],ax
or ax,ax
je @LA
mov bx,16:ss[bp+-22]
mov ax,16:ds[bx+2]
mov 16:ss[bp+-30],ax
jmp @LB
LA: mov 16:ss[bp+-30],#0
LB: mov ax,16:ds[si+102]
mov 16:ss[bp+-26],ax
or ax,ax
je @LC
mov bx,16:ss[bp+-26]
mov ax,16:ds[bx+0]
mov 16:ss[bp+-32],ax
jmp @LD
LC: mov 16:ss[bp+-32],#0
LD: mov ax,16:ds[si+104]
mov 16:ss[bp+-28],ax
or ax,ax
je @LE
mov bx,16:ss[bp+-28]
mov ax,16:ds[bx+0]
mov 16:ss[bp+-34],ax
jmp @LF
LE: mov 16:ss[bp+-34],#0
LF: cmp 16:ss[bp+6],#0
je @LH
cmp 16:ss[bp+6],si
je @LG
mov ax,16:ss[bp+6]
cmp ax,16:ss[bp+-30]
je @LG
cmp ax,16:ss[bp+-32]
je @LG
cmp ax,16:ss[bp+-34]
jne @LH
LG: sub 16:ss[bp+-10],#11
sub di,#11
add 16:ss[bp+-12],#11
add 16:ss[bp+-14],#11
LH: mov ax,16:ss[bp+-10]
cmp ax,16:ss[bp+-6]
jl @LI
jmp @LAC
LI: mov ax,16:ss[bp+-12]
cmp ax,16:ss[bp+-2]
jg @LJ
jmp @LAC
LJ: cmp di,16:ss[bp+-8]
jl @LK
jmp @LAC
LK: mov ax,16:ss[bp+-14]
cmp ax,16:ss[bp+-4]
jg @LL
jmp @LAC
LL: cmp 16:ss[bp+-22],#0
jne @LM
jmp @LS
LM: cmp 16:ds[{gE}],#9
jne @LN
jmp @LS
LN: mov al,8:ds[si+86]
mov ah,#0
mov dx,16:ss[bp+-20]
add dx,ax
mov 16:ss[bp+-10],dx
mov al,8:ds[si+87]
mov ah,#0
mov dx,16:ss[bp+-18]
add dx,ax
mov di,dx
mov ax,16:ss[bp+-10]
add ax,16:ds[si+88]
mov 16:ss[bp+-12],ax
mov ax,16:ds[si+70]
sar ax,#1
cmp ax,16:ds[si+88]
jge @LO
mov ax,di
add ax,#10
jmp @LP
LO: mov ax,di
add ax,16:ds[si+88]
LP: mov 16:ss[bp+-14],ax
mov bx,16:ss[bp+-22]
mov ax,16:ds[bx+2]
cmp ax,16:ss[bp+6]
jne @LQ
sub 16:ss[bp+-10],#11
sub di,#11
add 16:ss[bp+-12],#11
LQ: mov ax,16:ss[bp+-10]
cmp ax,16:ss[bp+-6]
jge @LS
mov ax,16:ss[bp+-12]
cmp ax,16:ss[bp+-2]
jle @LS
cmp di,16:ss[bp+-8]
jge @LS
mov ax,16:ss[bp+-14]
cmp ax,16:ss[bp+-4]
jle @LS
mov bx,16:ss[bp+-22]
cmp 16:ds[bx+4],si
jne @LR
mov ax,16:ds[bx+6]
mov 16:ds[bx+4],ax
mov 16:ds[bx+6],si
LR: mov bx,16:ss[bp+-22]
mov ax,16:ds[bx+2]
jmp @LAD
LS: mov ax,16:ss[bp+-26]
mov 16:ss[bp+-24],ax
mov 16:ss[bp+-16],#0
jmp @LAA
LT: cmp 16:ss[bp+-24],#0
jne @LU
jmp @LZ
LU: cmp 16:ds[{gE}],#9
jne @LV
jmp @LZ
LV: cmp 16:ds[si+4],#7
jne @LW
jmp @LZ
LW: mov bx,16:ss[bp+-16]
shl bx,#1
mov al,8:ds[bx+si+106]
mov ah,#0
mov dx,16:ss[bp+-20]
add dx,ax
add dx,#-8
mov 16:ss[bp+-10],dx
mov bx,16:ss[bp+-16]
shl bx,#1
mov al,8:ds[bx+si+107]
mov ah,#0
mov dx,16:ss[bp+-18]
add dx,ax
add dx,#-4
mov di,dx
mov ax,16:ss[bp+-10]
add ax,#16
mov 16:ss[bp+-12],ax
mov ax,di
add ax,#8
mov 16:ss[bp+-14],ax
mov bx,16:ss[bp+-24]
mov ax,16:ds[bx+0]
cmp ax,16:ss[bp+6]
jne @LX
sub 16:ss[bp+-10],#11
sub di,#11
add 16:ss[bp+-12],#11
LX: mov ax,16:ss[bp+-10]
cmp ax,16:ss[bp+-6]
jge @LZ
mov ax,16:ss[bp+-12]
cmp ax,16:ss[bp+-2]
jle @LZ
cmp di,16:ss[bp+-8]
jge @LZ
mov ax,16:ss[bp+-14]
cmp ax,16:ss[bp+-4]
jle @LZ
mov bx,16:ss[bp+-24]
cmp 16:ds[bx+2],si
jne @LY
push bx
push cs
call $ropeReverse
pop cx
LY: mov bx,16:ss[bp+-24]
mov ax,16:ds[bx+0]
jmp @LAD
LZ: mov ax,16:ss[bp+-28]
mov 16:ss[bp+-24],ax
inc 16:ss[bp+-16]
LAA: cmp 16:ss[bp+-16],#2
jge @LAB
jmp @LT
LAB: mov ax,si
jmp @LAD
LAC: xor ax,ax
LAD: pop di
pop si
mov sp,bp
pop bp
retf`,
  `push bp
mov bp,sp
sub sp,#34
push si
push di
mov si,16:ss[bp+8]
mov ax,16:ds[{gA}]
mov 16:ss[bp+-2],ax
mov 16:ss[bp+-6],ax
mov ax,16:ds[{gB}]
mov 16:ss[bp+-4],ax
mov 16:ss[bp+-8],ax
mov ax,16:ds[si+42]
sub ax,16:ds[{gC}]
mov 16:ss[bp+-20],ax
mov ax,16:ds[si+44]
sub ax,16:ds[{gD}]
mov 16:ss[bp+-18],ax
mov ax,16:ss[bp+-20]
mov 16:ss[bp+-10],ax
mov di,16:ss[bp+-18]
mov ax,16:ss[bp+-10]
add ax,16:ds[si+68]
mov 16:ss[bp+-12],ax
mov ax,di
add ax,16:ds[si+70]
mov 16:ss[bp+-14],ax
mov ax,16:ds[si+84]
mov 16:ss[bp+-22],ax
or ax,ax
je @LA
mov bx,16:ss[bp+-22]
mov ax,16:ds[bx+2]
mov 16:ss[bp+-30],ax
jmp @LB
LA: mov 16:ss[bp+-30],#0
LB: mov ax,16:ds[si+102]
mov 16:ss[bp+-26],ax
or ax,ax
je @LC
mov bx,16:ss[bp+-26]
mov ax,16:ds[bx+0]
mov 16:ss[bp+-32],ax
jmp @LD
LC: mov 16:ss[bp+-32],#0
LD: mov ax,16:ds[si+104]
mov 16:ss[bp+-28],ax
or ax,ax
je @LE
mov bx,16:ss[bp+-28]
mov ax,16:ds[bx+0]
mov 16:ss[bp+-34],ax
jmp @LF
LE: mov 16:ss[bp+-34],#0
LF: cmp 16:ss[bp+6],#0
je @LH
cmp 16:ss[bp+6],si
je @LG
mov ax,16:ss[bp+6]
cmp ax,16:ss[bp+-30]
je @LG
mov ax,16:ss[bp+6]
cmp ax,16:ss[bp+-32]
je @LG
mov ax,16:ss[bp+6]
cmp ax,16:ss[bp+-34]
jne @LH
LG: sub 16:ss[bp+-10],#11
sub di,#11
add 16:ss[bp+-12],#11
add 16:ss[bp+-14],#11
LH: mov ax,16:ss[bp+-10]
cmp ax,16:ss[bp+-6]
jl @LI
jmp @LAD
LI: mov ax,16:ss[bp+-12]
cmp ax,16:ss[bp+-2]
jg @LJ
jmp @LAD
LJ: cmp di,16:ss[bp+-8]
jl @LK
jmp @LAD
LK: mov ax,16:ss[bp+-14]
cmp ax,16:ss[bp+-4]
jg @LL
jmp @LAD
LL: cmp 16:ss[bp+-22],#0
jne @LM
jmp @LT
LM: cmp 16:ds[{gE}],#9
jne @LN
jmp @LT
LN: mov al,8:ds[si+86]
mov ah,#0
mov dx,16:ss[bp+-20]
add dx,ax
mov 16:ss[bp+-10],dx
mov al,8:ds[si+87]
mov ah,#0
mov dx,16:ss[bp+-18]
add dx,ax
mov di,dx
mov ax,16:ss[bp+-10]
add ax,16:ds[si+88]
mov 16:ss[bp+-12],ax
mov ax,16:ds[si+70]
sar ax,#1
cmp ax,16:ds[si+88]
jge @LO
mov ax,di
add ax,#10
jmp @LP
LO: mov ax,di
add ax,16:ds[si+88]
LP: mov 16:ss[bp+-14],ax
mov bx,16:ss[bp+-22]
mov ax,16:ds[bx+2]
cmp ax,16:ss[bp+6]
jne @LQ
sub 16:ss[bp+-10],#11
sub di,#11
add 16:ss[bp+-12],#11
LQ: mov ax,16:ss[bp+-10]
cmp ax,16:ss[bp+-6]
jge @LT
mov ax,16:ss[bp+-12]
cmp ax,16:ss[bp+-2]
jle @LT
cmp di,16:ss[bp+-8]
jge @LT
mov ax,16:ss[bp+-14]
cmp ax,16:ss[bp+-4]
jle @LT
mov bx,16:ss[bp+-22]
cmp 16:ds[bx+4],si
jne @LR
mov bx,16:ss[bp+-22]
mov ax,16:ds[bx+6]
mov bx,16:ss[bp+-22]
mov 16:ds[bx+4],ax
mov bx,16:ss[bp+-22]
mov 16:ds[bx+6],si
LR: mov bx,16:ss[bp+-22]
mov ax,16:ds[bx+2]
LS: jmp @LAE
LT: mov ax,16:ss[bp+-26]
mov 16:ss[bp+-24],ax
mov 16:ss[bp+-16],#0
jmp @LAB
LU: cmp 16:ss[bp+-24],#0
jne @LV
jmp @LAA
LV: cmp 16:ds[{gE}],#9
jne @LW
jmp @LAA
LW: cmp 16:ds[si+4],#7
jne @LX
jmp @LAA
LX: mov bx,16:ss[bp+-16]
shl bx,#1
mov al,8:ds[bx+si+106]
mov ah,#0
mov dx,16:ss[bp+-20]
add dx,ax
add dx,#-8
mov 16:ss[bp+-10],dx
mov bx,16:ss[bp+-16]
shl bx,#1
mov al,8:ds[bx+si+107]
mov ah,#0
mov dx,16:ss[bp+-18]
add dx,ax
add dx,#-4
mov di,dx
mov ax,16:ss[bp+-10]
add ax,#16
mov 16:ss[bp+-12],ax
mov ax,di
add ax,#8
mov 16:ss[bp+-14],ax
mov bx,16:ss[bp+-24]
mov ax,16:ds[bx+0]
cmp ax,16:ss[bp+6]
jne @LY
sub 16:ss[bp+-10],#11
sub di,#11
add 16:ss[bp+-12],#11
LY: mov ax,16:ss[bp+-10]
cmp ax,16:ss[bp+-6]
jge @LAA
mov ax,16:ss[bp+-12]
cmp ax,16:ss[bp+-2]
jle @LAA
cmp di,16:ss[bp+-8]
jge @LAA
mov ax,16:ss[bp+-14]
cmp ax,16:ss[bp+-4]
jle @LAA
mov bx,16:ss[bp+-24]
cmp 16:ds[bx+2],si
jne @LZ
push 16:ss[bp+-24]
push cs
call $ropeReverse
pop cx
LZ: mov bx,16:ss[bp+-24]
mov ax,16:ds[bx+0]
jmp @LS
LAA: mov ax,16:ss[bp+-28]
mov 16:ss[bp+-24],ax
inc 16:ss[bp+-16]
LAB: cmp 16:ss[bp+-16],#2
jge @LAC
jmp @LU
LAC: mov ax,si
jmp @LS
LAD: xor ax,ax
jmp @LS
LAE: pop di
pop si
mov sp,bp
pop bp
retf`,
  `push bp
mov bp,sp
sub sp,#34
push si
push di
mov si,16:ss[bp+8]
mov ax,16:ds[{gA}]
mov 16:ss[bp+-2],ax
mov 16:ss[bp+-6],ax
mov ax,16:ds[{gB}]
mov 16:ss[bp+-4],ax
mov 16:ss[bp+-8],ax
mov ax,16:ds[si+42]
sub ax,16:ds[{gC}]
mov 16:ss[bp+-20],ax
mov ax,16:ds[si+44]
sub ax,16:ds[{gD}]
mov 16:ss[bp+-18],ax
mov ax,16:ss[bp+-20]
mov 16:ss[bp+-10],ax
mov di,16:ss[bp+-18]
mov ax,16:ss[bp+-10]
add ax,16:ds[si+68]
mov 16:ss[bp+-12],ax
mov ax,di
add ax,16:ds[si+70]
mov 16:ss[bp+-14],ax
mov ax,16:ds[si+84]
mov 16:ss[bp+-22],ax
or ax,ax
je @LA
mov bx,16:ss[bp+-22]
mov ax,16:ds[bx+2]
mov 16:ss[bp+-30],ax
jmp @LB
LA: mov 16:ss[bp+-30],#0
LB: mov ax,16:ds[si+102]
mov 16:ss[bp+-26],ax
or ax,ax
je @LC
mov bx,16:ss[bp+-26]
mov ax,16:ds[bx+0]
mov 16:ss[bp+-32],ax
jmp @LD
LC: mov 16:ss[bp+-32],#0
LD: mov ax,16:ds[si+104]
mov 16:ss[bp+-28],ax
or ax,ax
je @LE
mov bx,16:ss[bp+-28]
mov ax,16:ds[bx+0]
mov 16:ss[bp+-34],ax
jmp @LF
LE: mov 16:ss[bp+-34],#0
LF: cmp 16:ss[bp+6],#0
je @LH
cmp 16:ss[bp+6],si
je @LG
mov ax,16:ss[bp+6]
cmp ax,16:ss[bp+-30]
je @LG
mov ax,16:ss[bp+6]
cmp ax,16:ss[bp+-32]
je @LG
mov ax,16:ss[bp+6]
cmp ax,16:ss[bp+-34]
jne @LH
LG: sub 16:ss[bp+-10],#11
sub di,#11
add 16:ss[bp+-12],#11
add 16:ss[bp+-14],#11
LH: mov ax,16:ss[bp+-10]
cmp ax,16:ss[bp+-6]
jl @LI
jmp @LAD
LI: mov ax,16:ss[bp+-12]
cmp ax,16:ss[bp+-2]
jg @LJ
jmp @LAD
LJ: cmp di,16:ss[bp+-8]
jl @LK
jmp @LAD
LK: mov ax,16:ss[bp+-14]
cmp ax,16:ss[bp+-4]
jg @LL
jmp @LAD
LL: cmp 16:ss[bp+-22],#0
jne @LM
jmp @LT
LM: cmp 16:ds[{gE}],#9
jne @LN
jmp @LT
LN: mov al,8:ds[si+86]
mov ah,#0
mov dx,16:ss[bp+-20]
add dx,ax
mov 16:ss[bp+-10],dx
mov al,8:ds[si+87]
mov ah,#0
mov dx,16:ss[bp+-18]
add dx,ax
mov di,dx
mov ax,16:ss[bp+-10]
add ax,16:ds[si+88]
mov 16:ss[bp+-12],ax
mov ax,16:ds[si+70]
sar ax,#1
cmp ax,16:ds[si+88]
jge @LO
mov ax,di
add ax,#10
jmp @LP
LO: mov ax,di
add ax,16:ds[si+88]
LP: mov 16:ss[bp+-14],ax
mov bx,16:ss[bp+-22]
mov ax,16:ds[bx+2]
cmp ax,16:ss[bp+6]
jne @LQ
sub 16:ss[bp+-10],#11
sub di,#11
LQ: mov ax,16:ss[bp+-10]
cmp ax,16:ss[bp+-6]
jge @LT
mov ax,16:ss[bp+-12]
cmp ax,16:ss[bp+-2]
jle @LT
cmp di,16:ss[bp+-8]
jge @LT
mov ax,16:ss[bp+-14]
cmp ax,16:ss[bp+-4]
jle @LT
mov bx,16:ss[bp+-22]
cmp 16:ds[bx+4],si
jne @LR
mov bx,16:ss[bp+-22]
mov ax,16:ds[bx+6]
mov bx,16:ss[bp+-22]
mov 16:ds[bx+4],ax
mov bx,16:ss[bp+-22]
mov 16:ds[bx+6],si
LR: mov bx,16:ss[bp+-22]
mov ax,16:ds[bx+2]
LS: jmp @LAE
LT: mov ax,16:ss[bp+-26]
mov 16:ss[bp+-24],ax
mov 16:ss[bp+-16],#0
jmp @LAB
LU: cmp 16:ss[bp+-24],#0
jne @LV
jmp @LAA
LV: cmp 16:ds[{gE}],#9
jne @LW
jmp @LAA
LW: cmp 16:ds[si+4],#7
jne @LX
jmp @LAA
LX: mov bx,16:ss[bp+-16]
shl bx,#1
mov al,8:ds[bx+si+106]
mov ah,#0
mov dx,16:ss[bp+-20]
add dx,ax
add dx,#-8
mov 16:ss[bp+-10],dx
mov bx,16:ss[bp+-16]
shl bx,#1
mov al,8:ds[bx+si+107]
mov ah,#0
mov dx,16:ss[bp+-18]
add dx,ax
add dx,#-4
mov di,dx
mov ax,16:ss[bp+-10]
add ax,#16
mov 16:ss[bp+-12],ax
mov ax,di
add ax,#8
mov 16:ss[bp+-14],ax
mov bx,16:ss[bp+-24]
mov ax,16:ds[bx+0]
cmp ax,16:ss[bp+6]
jne @LY
sub 16:ss[bp+-10],#11
sub di,#11
LY: mov ax,16:ss[bp+-10]
cmp ax,16:ss[bp+-6]
jge @LAA
mov ax,16:ss[bp+-12]
cmp ax,16:ss[bp+-2]
jle @LAA
cmp di,16:ss[bp+-8]
jge @LAA
mov ax,16:ss[bp+-14]
cmp ax,16:ss[bp+-4]
jle @LAA
mov bx,16:ss[bp+-24]
cmp 16:ds[bx+2],si
jne @LZ
push 16:ss[bp+-24]
push cs
call $ropeReverse
pop cx
LZ: mov bx,16:ss[bp+-24]
mov ax,16:ds[bx+0]
jmp @LS
LAA: mov ax,16:ss[bp+-28]
mov 16:ss[bp+-24],ax
inc 16:ss[bp+-16]
LAB: cmp 16:ss[bp+-16],#2
jge @LAC
jmp @LU
LAC: mov ax,si
jmp @LS
LAD: xor ax,ax
jmp @LS
LAE: pop di
pop si
mov sp,bp
pop bp
retf`,
];

/** Complete compiler forms of the list search that hit-tests every listed part. */
export const searchPatterns = [
  `push bp
mov bp,sp
sub sp,#4
push si
push di
mov di,16:ss[bp+6]
or di,di
je @LB
test 16:ds[di+10],#64
jne @LB
push di
push di
push cs
call $hitTest
pop cx
pop cx
mov si,ax
or ax,ax
je @LB
LA: mov ax,si
jmp @LM
LB: mov 16:ss[bp+-4],#0
mov ax,#12288
push ax
nop
push cs
call $listHead
pop cx
jmp @LJ
LC: push 16:ss[bp+-2]
push di
push cs
call $hitTest
pop cx
pop cx
mov si,ax
cmp si,16:ss[bp+-2]
jne @LD
mov bx,16:ss[bp+-2]
test 16:ds[bx+6],#32768
je @LD
or di,di
je @LD
jmp @LE
LD: test 16:ds[si+6],#32768
je @LF
or di,di
je @LF
LE: xor si,si
LF: or si,si
je @LI
test 16:ds[si+6],#32768
jne @LG
test 16:ds[si+10],#64
je @LH
LG: mov 16:ss[bp+-4],si
jmp @LI
LH: jmp @LA
LI: mov ax,#4096
push ax
push 16:ss[bp+-2]
nop
push cs
call $listNext
pop cx
pop cx
LJ: mov 16:ss[bp+-2],ax
cmp 16:ss[bp+-2],#0
jne @LC
cmp 16:ss[bp+-4],#0
je @LK
mov ax,16:ss[bp+-4]
jmp @LM
LK: cmp 16:ds[{gA}],#0
je @LL
mov bx,16:ds[{gA}]
cmp 16:ds[bx+4],#10
jne @LL
xor ax,ax
jmp @LM
LL: mov ax,di
LM: pop di
pop si
mov sp,bp
pop bp
retf`,
  `push bp
mov bp,sp
sub sp,#4
push si
push di
mov di,16:ss[bp+6]
or di,di
je @LC
test 16:ds[di+10],#64
jne @LC
push di
push di
push cs
call $hitTest
pop cx
pop cx
mov si,ax
or ax,ax
je @LC
LA: mov ax,si
LB: jmp @LM
LC: mov 16:ss[bp+-4],#0
mov ax,#12288
push ax
nop
push cs
call $listHead
pop cx
jmp @LJ
LD: push 16:ss[bp+-2]
push di
push cs
call $hitTest
pop cx
pop cx
mov si,ax
cmp si,16:ss[bp+-2]
jne @LE
mov bx,16:ss[bp+-2]
test 16:ds[bx+6],#32768
je @LE
or di,di
je @LE
xor si,si
jmp @LF
LE: test 16:ds[si+6],#32768
je @LF
or di,di
je @LF
xor si,si
LF: or si,si
je @LI
test 16:ds[si+6],#32768
jne @LG
test 16:ds[si+10],#64
je @LH
LG: mov 16:ss[bp+-4],si
jmp @LI
LH: jmp @LA
LI: mov ax,#4096
push ax
push 16:ss[bp+-2]
nop
push cs
call $listNext
pop cx
pop cx
LJ: mov 16:ss[bp+-2],ax
cmp 16:ss[bp+-2],#0
jne @LD
cmp 16:ss[bp+-4],#0
je @LK
mov ax,16:ss[bp+-4]
jmp @LB
LK: cmp 16:ds[{gA}],#0
je @LL
mov bx,16:ds[{gA}]
cmp 16:ds[bx+4],#10
jne @LL
xor ax,ax
jmp @LB
LL: mov ax,di
jmp @LB
LM: pop di
pop si
mov sp,bp
pop bp
retf`,
  `push bp
mov bp,sp
sub sp,#4
push si
push di
mov di,16:ss[bp+6]
or di,di
je @LC
push di
push di
push cs
call $hitTest
pop cx
pop cx
mov si,ax
or ax,ax
je @LC
LA: mov ax,si
LB: jmp @LL
LC: mov 16:ss[bp+-4],#0
mov ax,#12288
push ax
nop
push cs
call $listHead
pop cx
jmp @LI
LD: push 16:ss[bp+-2]
push di
push cs
call $hitTest
pop cx
pop cx
mov si,ax
cmp si,16:ss[bp+-2]
jne @LE
mov bx,16:ss[bp+-2]
test 16:ds[bx+6],#32768
je @LE
or di,di
je @LE
xor si,si
jmp @LF
LE: test 16:ds[si+6],#32768
je @LF
or di,di
je @LF
xor si,si
LF: or si,si
je @LH
test 16:ds[si+6],#32768
je @LG
mov 16:ss[bp+-4],si
jmp @LH
LG: jmp @LA
LH: mov ax,#4096
push ax
push 16:ss[bp+-2]
nop
push cs
call $listNext
pop cx
pop cx
LI: mov 16:ss[bp+-2],ax
cmp 16:ss[bp+-2],#0
jne @LD
cmp 16:ss[bp+-4],#0
je @LJ
mov ax,16:ss[bp+-4]
jmp @LB
LJ: cmp 16:ds[{gA}],#0
je @LK
mov bx,16:ds[{gA}]
cmp 16:ds[bx+4],#10
jne @LK
xor ax,ax
jmp @LB
LK: mov ax,di
jmp @LB
LL: pop di
pop si
mov sp,bp
pop bp
retf`,
];

/** Complete compiler forms of the belt end check that searches when an end is missing. */
export const beltEndsPatterns = [
  `push bp
mov bp,sp
push si
push di
mov bx,16:ss[bp+6]
mov ax,16:ds[bx+4]
mov si,ax
or ax,ax
jne @LE
xor ax,ax
push ax
push cs
call $search
pop cx
mov si,ax
or ax,ax
jne @LB
LA: xor ax,ax
jmp @LJ
LB: test 16:ds[si+8],#2
jne @LC
test 16:ds[si+8],#1
jne @LD
LC: jmp @LA
LD: mov ax,#1
jmp @LJ
LE: mov bx,16:ss[bp+6]
mov ax,16:ds[bx+6]
mov di,ax
or ax,ax
je @LF
jmp @LI
LF: xor ax,ax
push ax
push cs
call $search
pop cx
mov di,ax
or ax,ax
jne @LG
jmp @LA
LG: test 16:ds[di+8],#2
jne @LH
test 16:ds[di+8],#1
jne @LI
LH: jmp @LA
LI: mov ax,di
add ax,#30
push ax
mov ax,si
add ax,#30
push ax
push cs
call $pointCheck
pop cx
pop cx
LJ: pop di
pop si
pop bp
retf`,
  `push bp
mov bp,sp
push si
push di
mov bx,16:ss[bp+6]
mov ax,16:ds[bx+4]
mov si,ax
or ax,ax
jne @LF
xor ax,ax
push ax
push cs
call $search
pop cx
mov si,ax
or ax,ax
jne @LC
LA: xor ax,ax
LB: jmp @LK
LC: test 16:ds[si+8],#2
jne @LD
test 16:ds[si+8],#1
jne @LE
LD: jmp @LA
LE: mov ax,#1
jmp @LB
LF: mov bx,16:ss[bp+6]
mov ax,16:ds[bx+6]
mov di,ax
or ax,ax
je @LG
jmp @LJ
LG: xor ax,ax
push ax
push cs
call $search
pop cx
mov di,ax
or ax,ax
jne @LH
jmp @LA
LH: test 16:ds[di+8],#2
jne @LI
test 16:ds[di+8],#1
jne @LJ
LI: jmp @LA
LJ: mov ax,di
add ax,#30
push ax
mov ax,si
add ax,#30
push ax
push cs
call $pointCheck
pop cx
pop cx
jmp @LB
LK: pop di
pop si
pop bp
retf`,
];
