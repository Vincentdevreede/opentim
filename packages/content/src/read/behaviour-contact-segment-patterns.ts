/** Complete endpoint-test control flow, with scalar helper addresses bound by calls. */
export const segmentPatterns = [
  `push bp
mov bp,sp
sub sp,#22
push si
push di
mov si,16:ss[bp+6]
mov di,16:ss[bp+8]
mov ax,16:ds[si+2]
sub ax,16:ds[si+6]
mov 16:ss[bp+-2],ax
mov ax,16:ds[si+0]
sub ax,16:ds[si+4]
mov 16:ss[bp+-4],ax
mov ax,16:ds[si+4]
imul 16:ss[bp+-2]
push ax
mov ax,16:ds[si+6]
imul 16:ss[bp+-4]
pop dx
sub dx,ax
mov 16:ss[bp+-6],dx
mov ax,16:ds[di+6]
sub ax,16:ds[di+2]
mov 16:ss[bp+-8],ax
mov ax,16:ds[di+4]
sub ax,16:ds[di+0]
mov 16:ss[bp+-10],ax
mov ax,16:ds[di+0]
imul 16:ss[bp+-8]
push ax
mov ax,16:ds[di+2]
imul 16:ss[bp+-10]
pop dx
sub dx,ax
mov 16:ss[bp+-12],dx
mov ax,16:ss[bp+-8]
imul 16:ss[bp+-4]
push ax
mov ax,16:ss[bp+-2]
imul 16:ss[bp+-10]
pop dx
sub dx,ax
mov 16:ss[bp+-14],dx
cmp 16:ss[bp+-14],#0
je @labelCT
push 16:ss[bp+-4]
push 16:ss[bp+-12]
callf $calleeA
pop cx
pop cx
push ax
push dx
push 16:ss[bp+-10]
push 16:ss[bp+-6]
callf $calleeA
pop cx
pop cx
pop bx
pop cx
sub cx,ax
sbb bx,dx
mov 16:ss[bp+-20],bx
mov 16:ss[bp+-22],cx
mov ax,16:ss[bp+-14]
cwd
push dx
push ax
push 16:ss[bp+-20]
push cx
call $calleeB
mov 16:ss[bp+-16],ax
push 16:ss[bp+-12]
push 16:ss[bp+-2]
callf $calleeA
pop cx
pop cx
push ax
push dx
push 16:ss[bp+-6]
push 16:ss[bp+-8]
callf $calleeA
pop cx
pop cx
pop bx
pop cx
sub cx,ax
sbb bx,dx
mov 16:ss[bp+-20],bx
mov 16:ss[bp+-22],cx
mov ax,16:ss[bp+-14]
cwd
push dx
push ax
push 16:ss[bp+-20]
push cx
call $calleeB
jmp @labelDH
labelCT: mov ax,16:ds[si+0]
imul 16:ss[bp+-8]
push ax
mov ax,16:ds[si+2]
imul 16:ss[bp+-10]
pop dx
add dx,ax
je @labelDE
mov 16:ss[bp+-16],#0
mov 16:ss[bp+-18],#0
jmp @labelDI
labelDE: mov ax,16:ds[si+4]
mov 16:ss[bp+-16],ax
mov ax,16:ds[si+6]
labelDH: mov 16:ss[bp+-18],ax
labelDI: mov bx,16:ss[bp+10]
mov ax,16:ss[bp+-16]
mov 16:ds[bx+0],ax
mov ax,16:ss[bp+-18]
mov 16:ds[bx+2],ax
push 16:ds[si+4]
push 16:ds[si+0]
push 16:ss[bp+-16]
nop
push cs
call $calleeC
add sp,#6
or ax,ax
jne @labelDY
labelDW: xor ax,ax
jmp @labelFD
labelDY: push 16:ds[di+4]
push 16:ds[di+0]
push 16:ss[bp+-16]
nop
push cs
call $calleeC
add sp,#6
or ax,ax
jne @labelEI
jmp @labelDW
labelEI: push 16:ds[si+6]
push 16:ds[si+2]
push 16:ss[bp+-18]
nop
push cs
call $calleeC
add sp,#6
or ax,ax
jne @labelES
jmp @labelDW
labelES: push 16:ds[di+6]
push 16:ds[di+2]
push 16:ss[bp+-18]
nop
push cs
call $calleeC
add sp,#6
or ax,ax
jne @labelFC
jmp @labelDW
labelFC: mov ax,#1
labelFD: pop di
pop si
mov sp,bp
pop bp
retf`,
  `push bp
mov bp,sp
sub sp,#22
push si
push di
mov si,16:ss[bp+6]
mov di,16:ss[bp+8]
mov ax,16:ds[si+2]
sub ax,16:ds[si+6]
mov 16:ss[bp+-2],ax
mov ax,16:ds[si+0]
sub ax,16:ds[si+4]
mov 16:ss[bp+-4],ax
mov ax,16:ds[si+4]
imul 16:ss[bp+-2]
push ax
mov ax,16:ds[si+6]
imul 16:ss[bp+-4]
pop dx
sub dx,ax
mov 16:ss[bp+-6],dx
mov ax,16:ds[di+6]
sub ax,16:ds[di+2]
mov 16:ss[bp+-8],ax
mov ax,16:ds[di+4]
sub ax,16:ds[di+0]
mov 16:ss[bp+-10],ax
mov ax,16:ds[di+0]
imul 16:ss[bp+-8]
push ax
mov ax,16:ds[di+2]
imul 16:ss[bp+-10]
pop dx
sub dx,ax
mov 16:ss[bp+-12],dx
mov ax,16:ss[bp+-8]
imul 16:ss[bp+-4]
push ax
mov ax,16:ss[bp+-2]
imul 16:ss[bp+-10]
pop dx
sub dx,ax
mov 16:ss[bp+-14],dx
cmp 16:ss[bp+-14],#0
je @labelCU
push 16:ss[bp+-4]
push 16:ss[bp+-12]
callf $calleeA
pop cx
pop cx
push ax
push dx
push 16:ss[bp+-10]
push 16:ss[bp+-6]
callf $calleeA
pop cx
pop cx
pop bx
pop cx
sub cx,ax
sbb bx,dx
mov 16:ss[bp+-20],bx
mov 16:ss[bp+-22],cx
mov ax,16:ss[bp+-14]
cwd
push dx
push ax
push 16:ss[bp+-20]
push 16:ss[bp+-22]
callf $calleeB
mov 16:ss[bp+-16],ax
push 16:ss[bp+-12]
push 16:ss[bp+-2]
callf $calleeA
pop cx
pop cx
push ax
push dx
push 16:ss[bp+-6]
push 16:ss[bp+-8]
callf $calleeA
pop cx
pop cx
pop bx
pop cx
sub cx,ax
sbb bx,dx
mov 16:ss[bp+-20],bx
mov 16:ss[bp+-22],cx
mov ax,16:ss[bp+-14]
cwd
push dx
push ax
push 16:ss[bp+-20]
push 16:ss[bp+-22]
callf $calleeB
mov 16:ss[bp+-18],ax
jmp @labelDJ
labelCU: mov ax,16:ds[si+0]
imul 16:ss[bp+-8]
push ax
mov ax,16:ds[si+2]
imul 16:ss[bp+-10]
pop dx
add dx,ax
je @labelDF
mov 16:ss[bp+-16],#0
mov 16:ss[bp+-18],#0
jmp @labelDJ
labelDF: mov ax,16:ds[si+4]
mov 16:ss[bp+-16],ax
mov ax,16:ds[si+6]
mov 16:ss[bp+-18],ax
labelDJ: mov bx,16:ss[bp+10]
mov ax,16:ss[bp+-16]
mov 16:ds[bx+0],ax
mov bx,16:ss[bp+10]
mov ax,16:ss[bp+-18]
mov 16:ds[bx+2],ax
push 16:ds[si+4]
push 16:ds[si+0]
push 16:ss[bp+-16]
nop
push cs
call $calleeC
add sp,#6
or ax,ax
jne @labelEA
labelDY: xor ax,ax
labelDZ: jmp @labelFG
labelEA: push 16:ds[di+4]
push 16:ds[di+0]
push 16:ss[bp+-16]
nop
push cs
call $calleeC
add sp,#6
or ax,ax
jne @labelEK
jmp @labelDY
labelEK: push 16:ds[si+6]
push 16:ds[si+2]
push 16:ss[bp+-18]
nop
push cs
call $calleeC
add sp,#6
or ax,ax
jne @labelEU
jmp @labelDY
labelEU: push 16:ds[di+6]
push 16:ds[di+2]
push 16:ss[bp+-18]
nop
push cs
call $calleeC
add sp,#6
or ax,ax
jne @labelFE
jmp @labelDY
labelFE: mov ax,#1
jmp @labelDZ
labelFG: pop di
pop si
mov sp,bp
pop bp
retf`,
  `push bp
mov bp,sp
sub sp,#22
push si
push di
mov si,16:ss[bp+6]
mov di,16:ss[bp+8]
mov ax,16:ds[si+2]
sub ax,16:ds[si+6]
mov 16:ss[bp+-2],ax
mov ax,16:ds[si+0]
sub ax,16:ds[si+4]
mov 16:ss[bp+-4],ax
mov ax,16:ds[si+4]
imul 16:ss[bp+-2]
push ax
mov ax,16:ds[si+6]
imul 16:ss[bp+-4]
pop dx
sub dx,ax
mov 16:ss[bp+-6],dx
mov ax,16:ds[di+6]
sub ax,16:ds[di+2]
mov 16:ss[bp+-8],ax
mov ax,16:ds[di+4]
sub ax,16:ds[di+0]
mov 16:ss[bp+-10],ax
mov ax,16:ds[di+0]
imul 16:ss[bp+-8]
push ax
mov ax,16:ds[di+2]
imul 16:ss[bp+-10]
pop dx
sub dx,ax
mov 16:ss[bp+-12],dx
mov ax,16:ss[bp+-8]
imul 16:ss[bp+-4]
push ax
mov ax,16:ss[bp+-2]
imul 16:ss[bp+-10]
pop dx
sub dx,ax
mov 16:ss[bp+-14],dx
cmp 16:ss[bp+-14],#0
je @labelCT
push 16:ss[bp+-4]
push 16:ss[bp+-12]
callf $calleeA
pop cx
pop cx
push ax
push dx
push 16:ss[bp+-10]
push 16:ss[bp+-6]
callf $calleeA
pop cx
pop cx
pop bx
pop cx
sub cx,ax
sbb bx,dx
mov 16:ss[bp+-20],bx
mov 16:ss[bp+-22],cx
mov ax,16:ss[bp+-14]
cwd
push dx
push ax
push bx
push cx
call $calleeB
mov 16:ss[bp+-16],ax
push 16:ss[bp+-12]
push 16:ss[bp+-2]
callf $calleeA
pop cx
pop cx
push ax
push dx
push 16:ss[bp+-6]
push 16:ss[bp+-8]
callf $calleeA
pop cx
pop cx
pop bx
pop cx
sub cx,ax
sbb bx,dx
mov 16:ss[bp+-20],bx
mov 16:ss[bp+-22],cx
mov ax,16:ss[bp+-14]
cwd
push dx
push ax
push bx
push cx
call $calleeB
jmp @labelDH
labelCT: mov ax,16:ds[si+0]
imul 16:ss[bp+-8]
push ax
mov ax,16:ds[si+2]
imul 16:ss[bp+-10]
pop dx
add dx,ax
je @labelDE
mov 16:ss[bp+-16],#0
mov 16:ss[bp+-18],#0
jmp @labelDI
labelDE: mov ax,16:ds[si+4]
mov 16:ss[bp+-16],ax
mov ax,16:ds[si+6]
labelDH: mov 16:ss[bp+-18],ax
labelDI: mov bx,16:ss[bp+10]
mov ax,16:ss[bp+-16]
mov 16:ds[bx+0],ax
mov ax,16:ss[bp+-18]
mov 16:ds[bx+2],ax
push 16:ds[si+4]
push 16:ds[si+0]
push 16:ss[bp+-16]
nop
push cs
call $calleeC
add sp,#6
or ax,ax
jne @labelDY
labelDW: xor ax,ax
jmp @labelFD
labelDY: push 16:ds[di+4]
push 16:ds[di+0]
push 16:ss[bp+-16]
nop
push cs
call $calleeC
add sp,#6
or ax,ax
jne @labelEI
jmp @labelDW
labelEI: push 16:ds[si+6]
push 16:ds[si+2]
push 16:ss[bp+-18]
nop
push cs
call $calleeC
add sp,#6
or ax,ax
jne @labelES
jmp @labelDW
labelES: push 16:ds[di+6]
push 16:ds[di+2]
push 16:ss[bp+-18]
nop
push cs
call $calleeC
add sp,#6
or ax,ax
jne @labelFC
jmp @labelDW
labelFC: mov ax,#1
labelFD: pop di
pop si
mov sp,bp
pop bp
retf`,
  `push bp
mov bp,sp
sub sp,#22
push si
push di
mov si,16:ss[bp+6]
mov di,16:ss[bp+8]
mov ax,16:ds[si+2]
sub ax,16:ds[si+6]
mov 16:ss[bp+-2],ax
mov ax,16:ds[si+0]
sub ax,16:ds[si+4]
mov 16:ss[bp+-4],ax
mov ax,16:ds[si+4]
imul 16:ss[bp+-2]
push ax
mov ax,16:ds[si+6]
imul 16:ss[bp+-4]
pop dx
sub dx,ax
mov 16:ss[bp+-6],dx
mov ax,16:ds[di+6]
sub ax,16:ds[di+2]
mov 16:ss[bp+-8],ax
mov ax,16:ds[di+4]
sub ax,16:ds[di+0]
mov 16:ss[bp+-10],ax
mov ax,16:ds[di+0]
imul 16:ss[bp+-8]
push ax
mov ax,16:ds[di+2]
imul 16:ss[bp+-10]
pop dx
sub dx,ax
mov 16:ss[bp+-12],dx
mov ax,16:ss[bp+-8]
imul 16:ss[bp+-4]
push ax
mov ax,16:ss[bp+-2]
imul 16:ss[bp+-10]
pop dx
sub dx,ax
mov 16:ss[bp+-14],dx
cmp 16:ss[bp+-14],#0
je @labelCU
push 16:ss[bp+-4]
push 16:ss[bp+-12]
callf $calleeA
pop cx
pop cx
push ax
push dx
push 16:ss[bp+-10]
push 16:ss[bp+-6]
callf $calleeA
pop cx
pop cx
pop bx
pop cx
sub cx,ax
sbb bx,dx
mov 16:ss[bp+-20],bx
mov 16:ss[bp+-22],cx
mov ax,16:ss[bp+-14]
cwd
push dx
push ax
push 16:ss[bp+-20]
push 16:ss[bp+-22]
call $calleeB
mov 16:ss[bp+-16],ax
push 16:ss[bp+-12]
push 16:ss[bp+-2]
callf $calleeA
pop cx
pop cx
push ax
push dx
push 16:ss[bp+-6]
push 16:ss[bp+-8]
callf $calleeA
pop cx
pop cx
pop bx
pop cx
sub cx,ax
sbb bx,dx
mov 16:ss[bp+-20],bx
mov 16:ss[bp+-22],cx
mov ax,16:ss[bp+-14]
cwd
push dx
push ax
push 16:ss[bp+-20]
push 16:ss[bp+-22]
call $calleeB
mov 16:ss[bp+-18],ax
jmp @labelDJ
labelCU: mov ax,16:ds[si+0]
imul 16:ss[bp+-8]
push ax
mov ax,16:ds[si+2]
imul 16:ss[bp+-10]
pop dx
add dx,ax
je @labelDF
mov 16:ss[bp+-16],#0
mov 16:ss[bp+-18],#0
jmp @labelDJ
labelDF: mov ax,16:ds[si+4]
mov 16:ss[bp+-16],ax
mov ax,16:ds[si+6]
mov 16:ss[bp+-18],ax
labelDJ: mov bx,16:ss[bp+10]
mov ax,16:ss[bp+-16]
mov 16:ds[bx+0],ax
mov bx,16:ss[bp+10]
mov ax,16:ss[bp+-18]
mov 16:ds[bx+2],ax
push 16:ds[si+4]
push 16:ds[si+0]
push 16:ss[bp+-16]
nop
push cs
call $calleeC
add sp,#6
or ax,ax
jne @labelEA
labelDY: xor ax,ax
labelDZ: jmp @labelFG
labelEA: push 16:ds[di+4]
push 16:ds[di+0]
push 16:ss[bp+-16]
nop
push cs
call $calleeC
add sp,#6
or ax,ax
jne @labelEK
jmp @labelDY
labelEK: push 16:ds[si+6]
push 16:ds[si+2]
push 16:ss[bp+-18]
nop
push cs
call $calleeC
add sp,#6
or ax,ax
jne @labelEU
jmp @labelDY
labelEU: push 16:ds[di+6]
push 16:ds[di+2]
push 16:ss[bp+-18]
nop
push cs
call $calleeC
add sp,#6
or ax,ax
jne @labelFE
jmp @labelDY
labelFE: mov ax,#1
jmp @labelDZ
labelFG: pop di
pop si
mov sp,bp
pop bp
retf`,
];
