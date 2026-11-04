/** Complete compiler forms of the single-part reflection and two-part exchange responses. */
export const responsePairPatterns = [
  {
    kind: "reflection",
    pattern: `push bp
mov bp,sp
sub sp,#28
push si
push di
mov si,16:ss[bp+6]
push si
push cs
call $callA
pop cx
mov ax,si
add ax,#132
mov 16:ss[bp+-20],ax
mov bx,16:ss[bp+-20]
mov ax,16:ds[bx+0]
mov 16:ss[bp+-18],ax
mov ax,16:ds[si+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-22],#{tableSegment}
mov 16:ss[bp+-24],ax
mov bx,16:ss[bp+-18]
mov ax,16:ds[bx+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-26],#{tableSegment}
mov 16:ss[bp+-28],ax
mov bx,16:ss[bp+-20]
mov di,16:ds[bx+4]
or di,di
je @labelBJ
cmp di,#32768
jne @labelBW
labelBJ: mov bx,16:ss[bp+-20]
mov al,8:ds[bx+2]
mov ah,#0
or ax,ax
jne @labelBQ
add di,#4096
jmp @labelBW
labelBQ: mov bx,16:ss[bp+-20]
mov al,8:ds[bx+3]
mov ah,#0
or ax,ax
jne @labelBW
sub di,#4096
labelBW: mov ax,16:ds[si+54]
mov 16:ss[bp+-2],ax
mov ax,16:ds[si+56]
mov 16:ss[bp+-4],ax
push di
lea ax,16:ss[bp+-4]
push ax
lea ax,16:ss[bp+-2]
push ax
nop
push cs
call $callB
add sp,#6
les bx,32:ss[bp+-24]
mov ax,16:es[bx+4]
les bx,32:ss[bp+-28]
cmp ax,16:es[bx+4]
jge @labelCQ
les bx,32:ss[bp+-24]
jmp @labelCS
labelCQ: les bx,32:ss[bp+-28]
mov ax,16:es[bx+4]
labelCS: mov 16:ss[bp+-8],ax
cmp 16:ds[si+4],#59
jne @labelDA
cmp 16:ss[bp+-8],#128
jl @labelDA
les bx,32:ss[bp+-24]
mov ax,16:es[bx+4]
mov 16:ss[bp+-8],ax
labelDA: les bx,32:ss[bp+-24]
cmp 16:es[bx+6],#0
je @labelEI
push 16:ss[bp+-8]
push 16:ss[bp+-4]
callf $callC
pop cx
pop cx
mov 16:ss[bp+-14],dx
mov 16:ss[bp+-16],ax
mov dx,16:ss[bp+-14]
mov cl,#8
call $callD
mov 16:ss[bp+-4],ax
xor ax,ax
sub ax,16:ss[bp+-4]
mov 16:ss[bp+-4],ax
cmp 16:ss[bp+-4],#0
jge @labelEB
add ax,#64
mov 16:ss[bp+-6],ax
cmp 16:ss[bp+-6],#0
jge @labelDZ
labelDX: mov ax,16:ss[bp+-6]
jmp @labelEK
labelDZ: mov 16:ss[bp+-4],#0
jmp @labelEL
labelEB: mov ax,16:ss[bp+-4]
add ax,#65472
mov 16:ss[bp+-6],ax
cmp 16:ss[bp+-6],#0
jle @labelEH
jmp @labelDX
labelEH: jmp @labelDZ
labelEI: xor ax,ax
sub ax,16:ss[bp+-4]
labelEK: mov 16:ss[bp+-4],ax
labelEL: xor ax,ax
sub ax,di
push ax
lea ax,16:ss[bp+-4]
push ax
lea ax,16:ss[bp+-2]
push ax
nop
push cs
call $callB
add sp,#6
mov ax,16:ss[bp+-2]
mov 16:ds[si+54],ax
mov ax,16:ss[bp+-4]
mov 16:ds[si+56],ax
push si
push cs
call $callE
pop cx
mov ax,16:ds[si+30]
cwd
mov 16:ss[bp+-10],dx
mov 16:ss[bp+-12],ax
cmp 16:ss[bp+-2],#0
jl @labelFS
mov dx,16:ss[bp+-10]
add ax,#1
adc dx,#0
mov cl,#9
call $callF
add ax,#65535
adc dx,#-1
jmp @labelFW
labelFS: mov dx,16:ss[bp+-10]
mov ax,16:ss[bp+-12]
mov cl,#9
call $callF
labelFW: mov 16:ds[si+24],dx
mov 16:ds[si+22],ax
mov ax,16:ds[si+32]
cwd
mov 16:ss[bp+-14],dx
mov 16:ss[bp+-16],ax
les bx,32:ss[bp+-24]
cmp 16:es[bx+8],#0
jl @labelGN
mov dx,16:ss[bp+-14]
add ax,#1
adc dx,#0
mov cl,#9
call $callF
add ax,#65535
adc dx,#-1
jmp @labelGR
labelGN: mov dx,16:ss[bp+-14]
mov ax,16:ss[bp+-16]
mov cl,#9
call $callF
labelGR: mov 16:ds[si+28],dx
mov 16:ds[si+26],ax
pop di
pop si
mov sp,bp
pop bp
retf`,
  },
  {
    kind: "exchange",
    pattern: `push bp
mov bp,sp
sub sp,#58
push si
push di
mov si,16:ss[bp+6]
push si
push cs
call $callA
pop cx
mov di,16:ds[si+132]
or 16:ds[si+6],#8
or 16:ds[di+6],#8
mov ax,16:ds[si+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-52],#{tableSegment}
mov 16:ss[bp+-54],ax
mov ax,16:ds[di+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-56],#{tableSegment}
mov 16:ss[bp+-58],ax
les bx,32:ss[bp+-54]
mov ax,16:es[bx+2]
mov 16:ss[bp+-4],ax
les bx,32:ss[bp+-58]
mov ax,16:es[bx+2]
mov 16:ss[bp+-6],ax
mov ax,16:ds[si+54]
mov 16:ss[bp+-12],ax
mov ax,16:ds[si+56]
mov 16:ss[bp+-14],ax
mov ax,16:ds[di+54]
mov 16:ss[bp+-16],ax
mov ax,16:ds[di+56]
mov 16:ss[bp+-18],ax
push di
push si
nop
push cs
call $callB
pop cx
pop cx
mov 16:ss[bp+-2],ax
sub 16:ss[bp+-2],#16384
push 16:ss[bp+-2]
lea ax,16:ss[bp+-14]
push ax
lea ax,16:ss[bp+-12]
push ax
nop
push cs
call $callC
add sp,#6
push 16:ss[bp+-2]
lea ax,16:ss[bp+-18]
push ax
lea ax,16:ss[bp+-16]
push ax
nop
push cs
call $callC
add sp,#6
mov ax,16:ss[bp+-4]
cwd
mov 16:ss[bp+-8],dx
mov 16:ss[bp+-10],ax
mov ax,16:ss[bp+-6]
cwd
add 16:ss[bp+-10],ax
adc 16:ss[bp+-8],dx
push 16:ss[bp+-12]
push 16:ss[bp+-4]
callf $callD
pop cx
pop cx
mov 16:ss[bp+-28],dx
mov 16:ss[bp+-30],ax
push 16:ss[bp+-16]
push 16:ss[bp+-6]
callf $callD
pop cx
pop cx
mov 16:ss[bp+-32],dx
mov 16:ss[bp+-34],ax
push 16:ss[bp+-12]
push 16:ss[bp+-6]
callf $callD
pop cx
pop cx
mov 16:ss[bp+-36],dx
mov 16:ss[bp+-38],ax
push 16:ss[bp+-16]
push 16:ss[bp+-4]
callf $callD
pop cx
pop cx
mov 16:ss[bp+-40],dx
mov 16:ss[bp+-42],ax
push 16:ss[bp+-8]
push 16:ss[bp+-10]
mov ax,16:ss[bp+-28]
mov dx,16:ss[bp+-30]
add dx,16:ss[bp+-34]
adc ax,16:ss[bp+-32]
add dx,16:ss[bp+-34]
adc ax,16:ss[bp+-32]
sub dx,16:ss[bp+-38]
sbb ax,16:ss[bp+-36]
push ax
push dx
call $callE
mov 16:ss[bp+-12],ax
push 16:ss[bp+-8]
push 16:ss[bp+-10]
mov ax,16:ss[bp+-28]
mov dx,16:ss[bp+-30]
add dx,16:ss[bp+-30]
adc ax,16:ss[bp+-28]
add dx,16:ss[bp+-34]
adc ax,16:ss[bp+-32]
sub dx,16:ss[bp+-42]
sbb ax,16:ss[bp+-40]
push ax
push dx
call $callE
mov 16:ss[bp+-16],ax
xor ax,ax
sub ax,16:ss[bp+-2]
push ax
lea ax,16:ss[bp+-14]
push ax
lea ax,16:ss[bp+-12]
push ax
nop
push cs
call $callC
add sp,#6
xor ax,ax
sub ax,16:ss[bp+-2]
push ax
lea ax,16:ss[bp+-18]
push ax
lea ax,16:ss[bp+-16]
push ax
nop
push cs
call $callC
add sp,#6
mov ax,16:ss[bp+-12]
sar ax,#1
mov 16:ds[si+54],ax
mov ax,16:ss[bp+-14]
sar ax,#1
mov 16:ds[si+56],ax
mov ax,16:ss[bp+-16]
sar ax,#1
mov 16:ds[di+54],ax
mov ax,16:ss[bp+-18]
sar ax,#1
mov 16:ds[di+56],ax
mov 16:ss[bp+-26],#0
mov ax,16:ds[si+54]
cwd
xor ax,dx
sub ax,dx
cmp ax,#256
jge @labelGW
mov ax,16:ds[di+54]
cwd
xor ax,dx
sub ax,dx
cmp ax,#256
jge @labelGW
mov 16:ss[bp+-26],#1
labelGW: test 16:ds[si+6],#1
je @labelGZ
mov 16:ss[bp+-26],#1
labelGZ: mov ax,16:ds[si+54]
cwd
xor ax,dx
sub ax,dx
push ax
mov ax,16:ds[si+56]
cwd
xor ax,dx
sub ax,dx
pop dx
cmp dx,ax
jle @labelHM
mov 16:ss[bp+-26],#0
labelHM: test 16:ds[si+10],#16
je @labelHP
mov 16:ss[bp+-26],#1
labelHP: cmp 16:ss[bp+-26],#0
je @labelJH
mov 16:ss[bp+-24],#1024
mov ax,16:ds[si+68]
sar ax,#1
mov dx,16:ds[si+30]
add dx,ax
mov 16:ss[bp+-20],dx
mov ax,16:ds[di+68]
sar ax,#1
mov dx,16:ds[di+30]
add dx,ax
mov 16:ss[bp+-22],dx
mov ax,16:ss[bp+-20]
cmp ax,16:ss[bp+-22]
jge @labelIT
mov ax,16:ss[bp+-24]
neg ax
cmp 16:ds[si+54],ax
jle @labelIM
mov ax,16:ss[bp+-24]
neg ax
mov 16:ds[si+54],ax
labelIM: test 16:ds[si+10],#16
jne @labelJH
mov ax,16:ds[di+54]
cmp ax,16:ss[bp+-24]
jge @labelJH
mov ax,16:ss[bp+-24]
jmp @labelJG
labelIT: mov ax,16:ds[si+54]
cmp ax,16:ss[bp+-24]
jge @labelIY
mov ax,16:ss[bp+-24]
mov 16:ds[si+54],ax
labelIY: test 16:ds[si+10],#16
jne @labelJH
mov ax,16:ss[bp+-24]
neg ax
cmp 16:ds[di+54],ax
jle @labelJH
mov ax,16:ss[bp+-24]
neg ax
labelJG: mov 16:ds[di+54],ax
labelJH: push si
push cs
call $callF
pop cx
push di
push cs
call $callF
pop cx
mov ax,16:ds[si+30]
cwd
mov 16:ss[bp+-44],dx
mov 16:ss[bp+-46],ax
cmp 16:ds[si+54],#0
jl @labelKD
mov dx,16:ss[bp+-44]
add ax,#1
adc dx,#0
mov cl,#9
call $callG
add ax,#65535
adc dx,#-1
jmp @labelKH
labelKD: mov dx,16:ss[bp+-44]
mov ax,16:ss[bp+-46]
mov cl,#9
call $callG
labelKH: mov 16:ds[si+24],dx
mov 16:ds[si+22],ax
mov ax,16:ds[si+32]
cwd
mov 16:ss[bp+-48],dx
mov 16:ss[bp+-50],ax
mov ax,16:ds[si+4]
mov dx,#58
imul dx
mov dx,#{tableSegment}
mov bx,ax
mov es,dx
cmp 16:es[bx+8],#0
jl @labelLE
mov dx,16:ss[bp+-48]
mov ax,16:ss[bp+-50]
add ax,#1
adc dx,#0
mov cl,#9
call $callG
add ax,#65535
adc dx,#-1
jmp @labelLI
labelLE: mov dx,16:ss[bp+-48]
mov ax,16:ss[bp+-50]
mov cl,#9
call $callG
labelLI: mov 16:ds[si+28],dx
mov 16:ds[si+26],ax
mov ax,16:ds[di+30]
cwd
mov 16:ss[bp+-44],dx
mov 16:ss[bp+-46],ax
cmp 16:ds[di+54],#0
jl @labelLY
mov dx,16:ss[bp+-44]
add ax,#1
adc dx,#0
mov cl,#9
call $callG
add ax,#65535
adc dx,#-1
jmp @labelMC
labelLY: mov dx,16:ss[bp+-44]
mov ax,16:ss[bp+-46]
mov cl,#9
call $callG
labelMC: mov 16:ds[di+24],dx
mov 16:ds[di+22],ax
mov ax,16:ds[di+32]
cwd
mov 16:ss[bp+-48],dx
mov 16:ss[bp+-50],ax
mov ax,16:ds[di+4]
mov dx,#58
imul dx
mov dx,#{tableSegment}
mov bx,ax
mov es,dx
cmp 16:es[bx+8],#0
jl @labelMZ
mov dx,16:ss[bp+-48]
mov ax,16:ss[bp+-50]
add ax,#1
adc dx,#0
mov cl,#9
call $callG
add ax,#65535
adc dx,#-1
jmp @labelND
labelMZ: mov dx,16:ss[bp+-48]
mov ax,16:ss[bp+-50]
mov cl,#9
call $callG
labelND: mov 16:ds[di+28],dx
mov 16:ds[di+26],ax
pop di
pop si
mov sp,bp
pop bp
retf`,
  },
  {
    kind: "reflection",
    pattern: `push bp
mov bp,sp
sub sp,#28
push si
push di
mov si,16:ss[bp+6]
push si
push cs
call $callA
pop cx
mov ax,si
add ax,#132
mov 16:ss[bp+-20],ax
mov bx,16:ss[bp+-20]
mov ax,16:ds[bx+0]
mov 16:ss[bp+-18],ax
mov ax,16:ds[si+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-22],#{tableSegment}
mov 16:ss[bp+-24],ax
mov bx,16:ss[bp+-18]
mov ax,16:ds[bx+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-26],#{tableSegment}
mov 16:ss[bp+-28],ax
mov bx,16:ss[bp+-20]
mov di,16:ds[bx+4]
or di,di
je @labelBJ
cmp di,#32768
jne @labelBW
labelBJ: mov bx,16:ss[bp+-20]
mov al,8:ds[bx+2]
mov ah,#0
or ax,ax
jne @labelBQ
add di,#4096
jmp @labelBW
labelBQ: mov bx,16:ss[bp+-20]
mov al,8:ds[bx+3]
mov ah,#0
or ax,ax
jne @labelBW
sub di,#4096
labelBW: mov ax,16:ds[si+54]
mov 16:ss[bp+-2],ax
mov ax,16:ds[si+56]
mov 16:ss[bp+-4],ax
push di
lea ax,16:ss[bp+-4]
push ax
lea ax,16:ss[bp+-2]
push ax
callf $callB
add sp,#6
les bx,32:ss[bp+-24]
mov ax,16:es[bx+4]
les bx,32:ss[bp+-28]
cmp ax,16:es[bx+4]
jge @labelCP
les bx,32:ss[bp+-24]
mov ax,16:es[bx+4]
jmp @labelCR
labelCP: les bx,32:ss[bp+-28]
mov ax,16:es[bx+4]
labelCR: mov 16:ss[bp+-8],ax
cmp 16:ds[si+4],#59
jne @labelCZ
cmp 16:ss[bp+-8],#128
jl @labelCZ
les bx,32:ss[bp+-24]
mov ax,16:es[bx+4]
mov 16:ss[bp+-8],ax
labelCZ: les bx,32:ss[bp+-24]
cmp 16:es[bx+6],#0
je @labelEN
push 16:ss[bp+-8]
push 16:ss[bp+-4]
callf $callC
pop cx
pop cx
mov 16:ss[bp+-14],dx
mov 16:ss[bp+-16],ax
mov dx,16:ss[bp+-14]
mov ax,16:ss[bp+-16]
mov cl,#8
callf $callD
mov 16:ss[bp+-4],ax
xor ax,ax
sub ax,16:ss[bp+-4]
mov 16:ss[bp+-4],ax
cmp 16:ss[bp+-4],#0
jge @labelED
mov ax,16:ss[bp+-4]
add ax,#64
mov 16:ss[bp+-6],ax
cmp 16:ss[bp+-6],#0
jge @labelEB
mov ax,16:ss[bp+-6]
mov 16:ss[bp+-4],ax
jmp @labelEC
labelEB: mov 16:ss[bp+-4],#0
labelEC: jmp @labelEM
labelED: mov ax,16:ss[bp+-4]
add ax,#65472
mov 16:ss[bp+-6],ax
cmp 16:ss[bp+-6],#0
jle @labelEL
mov ax,16:ss[bp+-6]
mov 16:ss[bp+-4],ax
jmp @labelEM
labelEL: mov 16:ss[bp+-4],#0
labelEM: jmp @labelEQ
labelEN: xor ax,ax
sub ax,16:ss[bp+-4]
mov 16:ss[bp+-4],ax
labelEQ: xor ax,ax
sub ax,di
push ax
lea ax,16:ss[bp+-4]
push ax
lea ax,16:ss[bp+-2]
push ax
callf $callB
add sp,#6
mov ax,16:ss[bp+-2]
mov 16:ds[si+54],ax
mov ax,16:ss[bp+-4]
mov 16:ds[si+56],ax
push si
push cs
call $callE
pop cx
mov ax,16:ds[si+30]
cwd
mov 16:ss[bp+-10],dx
mov 16:ss[bp+-12],ax
cmp 16:ss[bp+-2],#0
jl @labelFW
mov dx,16:ss[bp+-10]
mov ax,16:ss[bp+-12]
add ax,#1
adc dx,#0
mov cl,#9
callf $callF
add ax,#65535
adc dx,#-1
jmp @labelGA
labelFW: mov dx,16:ss[bp+-10]
mov ax,16:ss[bp+-12]
mov cl,#9
callf $callF
labelGA: mov 16:ds[si+24],dx
mov 16:ds[si+22],ax
mov ax,16:ds[si+32]
cwd
mov 16:ss[bp+-14],dx
mov 16:ss[bp+-16],ax
les bx,32:ss[bp+-24]
cmp 16:es[bx+8],#0
jl @labelGS
mov dx,16:ss[bp+-14]
mov ax,16:ss[bp+-16]
add ax,#1
adc dx,#0
mov cl,#9
callf $callF
add ax,#65535
adc dx,#-1
jmp @labelGW
labelGS: mov dx,16:ss[bp+-14]
mov ax,16:ss[bp+-16]
mov cl,#9
callf $callF
labelGW: mov 16:ds[si+28],dx
mov 16:ds[si+26],ax
pop di
pop si
mov sp,bp
pop bp
retf`,
  },
  {
    kind: "exchange",
    pattern: `push bp
mov bp,sp
sub sp,#58
push si
push di
mov si,16:ss[bp+6]
push si
push cs
call $callA
pop cx
mov di,16:ds[si+132]
or 16:ds[si+6],#8
or 16:ds[di+6],#8
mov ax,16:ds[si+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-52],#{tableSegment}
mov 16:ss[bp+-54],ax
mov ax,16:ds[di+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-56],#{tableSegment}
mov 16:ss[bp+-58],ax
les bx,32:ss[bp+-54]
mov ax,16:es[bx+2]
mov 16:ss[bp+-4],ax
les bx,32:ss[bp+-58]
mov ax,16:es[bx+2]
mov 16:ss[bp+-6],ax
mov ax,16:ds[si+54]
mov 16:ss[bp+-12],ax
mov ax,16:ds[si+56]
mov 16:ss[bp+-14],ax
mov ax,16:ds[di+54]
mov 16:ss[bp+-16],ax
mov ax,16:ds[di+56]
mov 16:ss[bp+-18],ax
push di
push si
callf $callB
pop cx
pop cx
mov 16:ss[bp+-2],ax
sub 16:ss[bp+-2],#16384
push 16:ss[bp+-2]
lea ax,16:ss[bp+-14]
push ax
lea ax,16:ss[bp+-12]
push ax
callf $callC
add sp,#6
push 16:ss[bp+-2]
lea ax,16:ss[bp+-18]
push ax
lea ax,16:ss[bp+-16]
push ax
callf $callC
add sp,#6
mov ax,16:ss[bp+-4]
cwd
mov 16:ss[bp+-8],dx
mov 16:ss[bp+-10],ax
mov ax,16:ss[bp+-6]
cwd
add 16:ss[bp+-10],ax
adc 16:ss[bp+-8],dx
push 16:ss[bp+-12]
push 16:ss[bp+-4]
callf $callD
pop cx
pop cx
mov 16:ss[bp+-28],dx
mov 16:ss[bp+-30],ax
push 16:ss[bp+-16]
push 16:ss[bp+-6]
callf $callD
pop cx
pop cx
mov 16:ss[bp+-32],dx
mov 16:ss[bp+-34],ax
push 16:ss[bp+-12]
push 16:ss[bp+-6]
callf $callD
pop cx
pop cx
mov 16:ss[bp+-36],dx
mov 16:ss[bp+-38],ax
push 16:ss[bp+-16]
push 16:ss[bp+-4]
callf $callD
pop cx
pop cx
mov 16:ss[bp+-40],dx
mov 16:ss[bp+-42],ax
push 16:ss[bp+-8]
push 16:ss[bp+-10]
mov ax,16:ss[bp+-28]
mov dx,16:ss[bp+-30]
add dx,16:ss[bp+-34]
adc ax,16:ss[bp+-32]
add dx,16:ss[bp+-34]
adc ax,16:ss[bp+-32]
sub dx,16:ss[bp+-38]
sbb ax,16:ss[bp+-36]
push ax
push dx
callf $callE
mov 16:ss[bp+-12],ax
push 16:ss[bp+-8]
push 16:ss[bp+-10]
mov ax,16:ss[bp+-28]
mov dx,16:ss[bp+-30]
add dx,16:ss[bp+-30]
adc ax,16:ss[bp+-28]
add dx,16:ss[bp+-34]
adc ax,16:ss[bp+-32]
sub dx,16:ss[bp+-42]
sbb ax,16:ss[bp+-40]
push ax
push dx
callf $callE
mov 16:ss[bp+-16],ax
xor ax,ax
sub ax,16:ss[bp+-2]
push ax
lea ax,16:ss[bp+-14]
push ax
lea ax,16:ss[bp+-12]
push ax
callf $callC
add sp,#6
xor ax,ax
sub ax,16:ss[bp+-2]
push ax
lea ax,16:ss[bp+-18]
push ax
lea ax,16:ss[bp+-16]
push ax
callf $callC
add sp,#6
mov ax,16:ss[bp+-12]
sar ax,#1
mov 16:ds[si+54],ax
mov ax,16:ss[bp+-14]
sar ax,#1
mov 16:ds[si+56],ax
mov ax,16:ss[bp+-16]
sar ax,#1
mov 16:ds[di+54],ax
mov ax,16:ss[bp+-18]
sar ax,#1
mov 16:ds[di+56],ax
mov 16:ss[bp+-26],#0
mov ax,16:ds[si+54]
cwd
xor ax,dx
sub ax,dx
cmp ax,#256
jge @labelGM
mov ax,16:ds[di+54]
cwd
xor ax,dx
sub ax,dx
cmp ax,#256
jge @labelGM
mov 16:ss[bp+-26],#1
labelGM: test 16:ds[si+6],#1
je @labelGP
mov 16:ss[bp+-26],#1
labelGP: mov ax,16:ds[si+54]
cwd
xor ax,dx
sub ax,dx
push ax
mov ax,16:ds[si+56]
cwd
xor ax,dx
sub ax,dx
pop dx
cmp dx,ax
jle @labelHC
mov 16:ss[bp+-26],#0
labelHC: test 16:ds[si+10],#16
je @labelHF
mov 16:ss[bp+-26],#1
labelHF: cmp 16:ss[bp+-26],#0
je @labelIY
mov 16:ss[bp+-24],#1024
mov ax,16:ds[si+68]
sar ax,#1
mov dx,16:ds[si+30]
add dx,ax
mov 16:ss[bp+-20],dx
mov ax,16:ds[di+68]
sar ax,#1
mov dx,16:ds[di+30]
add dx,ax
mov 16:ss[bp+-22],dx
mov ax,16:ss[bp+-20]
cmp ax,16:ss[bp+-22]
jge @labelIK
mov ax,16:ss[bp+-24]
neg ax
cmp 16:ds[si+54],ax
jle @labelIC
mov ax,16:ss[bp+-24]
neg ax
mov 16:ds[si+54],ax
labelIC: test 16:ds[si+10],#16
jne @labelIJ
mov ax,16:ds[di+54]
cmp ax,16:ss[bp+-24]
jge @labelIJ
mov ax,16:ss[bp+-24]
mov 16:ds[di+54],ax
labelIJ: jmp @labelIY
labelIK: mov ax,16:ds[si+54]
cmp ax,16:ss[bp+-24]
jge @labelIP
mov ax,16:ss[bp+-24]
mov 16:ds[si+54],ax
labelIP: test 16:ds[si+10],#16
jne @labelIY
mov ax,16:ss[bp+-24]
neg ax
cmp 16:ds[di+54],ax
jle @labelIY
mov ax,16:ss[bp+-24]
neg ax
mov 16:ds[di+54],ax
labelIY: push si
push cs
call $callF
pop cx
push di
push cs
call $callF
pop cx
mov ax,16:ds[si+30]
cwd
mov 16:ss[bp+-44],dx
mov 16:ss[bp+-46],ax
cmp 16:ds[si+54],#0
jl @labelJV
mov dx,16:ss[bp+-44]
mov ax,16:ss[bp+-46]
add ax,#1
adc dx,#0
mov cl,#9
callf $callG
add ax,#65535
adc dx,#-1
jmp @labelJZ
labelJV: mov dx,16:ss[bp+-44]
mov ax,16:ss[bp+-46]
mov cl,#9
callf $callG
labelJZ: mov 16:ds[si+24],dx
mov 16:ds[si+22],ax
mov ax,16:ds[si+32]
cwd
mov 16:ss[bp+-48],dx
mov 16:ss[bp+-50],ax
mov ax,16:ds[si+4]
mov dx,#58
imul dx
mov dx,#{tableSegment}
mov bx,ax
mov es,dx
cmp 16:es[bx+8],#0
jl @labelKW
mov dx,16:ss[bp+-48]
mov ax,16:ss[bp+-50]
add ax,#1
adc dx,#0
mov cl,#9
callf $callG
add ax,#65535
adc dx,#-1
jmp @labelLA
labelKW: mov dx,16:ss[bp+-48]
mov ax,16:ss[bp+-50]
mov cl,#9
callf $callG
labelLA: mov 16:ds[si+28],dx
mov 16:ds[si+26],ax
mov ax,16:ds[di+30]
cwd
mov 16:ss[bp+-44],dx
mov 16:ss[bp+-46],ax
cmp 16:ds[di+54],#0
jl @labelLR
mov dx,16:ss[bp+-44]
mov ax,16:ss[bp+-46]
add ax,#1
adc dx,#0
mov cl,#9
callf $callG
add ax,#65535
adc dx,#-1
jmp @labelLV
labelLR: mov dx,16:ss[bp+-44]
mov ax,16:ss[bp+-46]
mov cl,#9
callf $callG
labelLV: mov 16:ds[di+24],dx
mov 16:ds[di+22],ax
mov ax,16:ds[di+32]
cwd
mov 16:ss[bp+-48],dx
mov 16:ss[bp+-50],ax
mov ax,16:ds[di+4]
mov dx,#58
imul dx
mov dx,#{tableSegment}
mov bx,ax
mov es,dx
cmp 16:es[bx+8],#0
jl @labelMS
mov dx,16:ss[bp+-48]
mov ax,16:ss[bp+-50]
add ax,#1
adc dx,#0
mov cl,#9
callf $callG
add ax,#65535
adc dx,#-1
jmp @labelMW
labelMS: mov dx,16:ss[bp+-48]
mov ax,16:ss[bp+-50]
mov cl,#9
callf $callG
labelMW: mov 16:ds[di+28],dx
mov 16:ds[di+26],ax
pop di
pop si
mov sp,bp
pop bp
retf`,
  },
  {
    kind: "reflection",
    pattern: `push bp
mov bp,sp
sub sp,#28
push si
push di
mov si,16:ss[bp+6]
push si
push cs
call $callA
pop cx
mov ax,si
add ax,#132
mov 16:ss[bp+-20],ax
mov bx,16:ss[bp+-20]
mov ax,16:ds[bx+0]
mov 16:ss[bp+-18],ax
mov ax,16:ds[si+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-22],#{tableSegment}
mov 16:ss[bp+-24],ax
mov bx,16:ss[bp+-18]
mov ax,16:ds[bx+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-26],#{tableSegment}
mov 16:ss[bp+-28],ax
mov bx,16:ss[bp+-20]
mov di,16:ds[bx+4]
or di,di
je @labelBJ
cmp di,#32768
jne @labelBW
labelBJ: mov bx,16:ss[bp+-20]
mov al,8:ds[bx+2]
mov ah,#0
or ax,ax
jne @labelBQ
add di,#4096
jmp @labelBW
labelBQ: mov bx,16:ss[bp+-20]
mov al,8:ds[bx+3]
mov ah,#0
or ax,ax
jne @labelBW
sub di,#4096
labelBW: mov ax,16:ds[si+54]
mov 16:ss[bp+-2],ax
mov ax,16:ds[si+56]
mov 16:ss[bp+-4],ax
push di
lea ax,16:ss[bp+-4]
push ax
lea ax,16:ss[bp+-2]
push ax
nop
push cs
call $callB
add sp,#6
les bx,32:ss[bp+-24]
mov ax,16:es[bx+4]
les bx,32:ss[bp+-28]
cmp ax,16:es[bx+4]
jge @labelCQ
les bx,32:ss[bp+-24]
jmp @labelCS
labelCQ: les bx,32:ss[bp+-28]
mov ax,16:es[bx+4]
labelCS: mov 16:ss[bp+-8],ax
cmp 16:ds[si+4],#59
jne @labelDA
cmp 16:ss[bp+-8],#128
jl @labelDA
les bx,32:ss[bp+-24]
mov ax,16:es[bx+4]
mov 16:ss[bp+-8],ax
labelDA: les bx,32:ss[bp+-24]
cmp 16:es[bx+6],#0
je @labelEH
push 16:ss[bp+-8]
push 16:ss[bp+-4]
callf $callC
pop cx
pop cx
mov 16:ss[bp+-14],dx
mov 16:ss[bp+-16],ax
mov cl,#8
call $callD
mov 16:ss[bp+-4],ax
xor ax,ax
sub ax,16:ss[bp+-4]
mov 16:ss[bp+-4],ax
cmp 16:ss[bp+-4],#0
jge @labelEA
add ax,#64
mov 16:ss[bp+-6],ax
cmp 16:ss[bp+-6],#0
jge @labelDY
labelDW: mov ax,16:ss[bp+-6]
jmp @labelEJ
labelDY: mov 16:ss[bp+-4],#0
jmp @labelEK
labelEA: mov ax,16:ss[bp+-4]
add ax,#65472
mov 16:ss[bp+-6],ax
cmp 16:ss[bp+-6],#0
jle @labelEG
jmp @labelDW
labelEG: jmp @labelDY
labelEH: xor ax,ax
sub ax,16:ss[bp+-4]
labelEJ: mov 16:ss[bp+-4],ax
labelEK: xor ax,ax
sub ax,di
push ax
lea ax,16:ss[bp+-4]
push ax
lea ax,16:ss[bp+-2]
push ax
nop
push cs
call $callB
add sp,#6
mov ax,16:ss[bp+-2]
mov 16:ds[si+54],ax
mov ax,16:ss[bp+-4]
mov 16:ds[si+56],ax
push si
push cs
call $callE
pop cx
mov ax,16:ds[si+30]
cwd
mov 16:ss[bp+-10],dx
mov 16:ss[bp+-12],ax
cmp 16:ss[bp+-2],#0
jl @labelFQ
add ax,#1
adc dx,#0
mov cl,#9
call $callF
add ax,#65535
adc dx,#-1
jmp @labelFU
labelFQ: mov dx,16:ss[bp+-10]
mov ax,16:ss[bp+-12]
mov cl,#9
call $callF
labelFU: mov 16:ds[si+24],dx
mov 16:ds[si+22],ax
mov ax,16:ds[si+32]
cwd
mov 16:ss[bp+-14],dx
mov 16:ss[bp+-16],ax
les bx,32:ss[bp+-24]
cmp 16:es[bx+8],#0
jl @labelGK
add ax,#1
adc dx,#0
mov cl,#9
call $callF
add ax,#65535
adc dx,#-1
jmp @labelGO
labelGK: mov dx,16:ss[bp+-14]
mov ax,16:ss[bp+-16]
mov cl,#9
call $callF
labelGO: mov 16:ds[si+28],dx
mov 16:ds[si+26],ax
pop di
pop si
mov sp,bp
pop bp
retf`,
  },
  {
    kind: "exchange",
    pattern: `push bp
mov bp,sp
sub sp,#58
push si
push di
mov si,16:ss[bp+6]
push si
push cs
call $callA
pop cx
mov di,16:ds[si+132]
or 16:ds[si+6],#8
or 16:ds[di+6],#8
mov ax,16:ds[si+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-52],#{tableSegment}
mov 16:ss[bp+-54],ax
mov ax,16:ds[di+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-56],#{tableSegment}
mov 16:ss[bp+-58],ax
les bx,32:ss[bp+-54]
mov ax,16:es[bx+2]
mov 16:ss[bp+-4],ax
les bx,32:ss[bp+-58]
mov ax,16:es[bx+2]
mov 16:ss[bp+-6],ax
mov ax,16:ds[si+54]
mov 16:ss[bp+-12],ax
mov ax,16:ds[si+56]
mov 16:ss[bp+-14],ax
mov ax,16:ds[di+54]
mov 16:ss[bp+-16],ax
mov ax,16:ds[di+56]
mov 16:ss[bp+-18],ax
push di
push si
nop
push cs
call $callB
pop cx
pop cx
mov 16:ss[bp+-2],ax
sub 16:ss[bp+-2],#16384
push 16:ss[bp+-2]
lea ax,16:ss[bp+-14]
push ax
lea ax,16:ss[bp+-12]
push ax
nop
push cs
call $callC
add sp,#6
push 16:ss[bp+-2]
lea ax,16:ss[bp+-18]
push ax
lea ax,16:ss[bp+-16]
push ax
nop
push cs
call $callC
add sp,#6
mov ax,16:ss[bp+-4]
cwd
mov 16:ss[bp+-8],dx
mov 16:ss[bp+-10],ax
mov ax,16:ss[bp+-6]
cwd
add 16:ss[bp+-10],ax
adc 16:ss[bp+-8],dx
push 16:ss[bp+-12]
push 16:ss[bp+-4]
callf $callD
pop cx
pop cx
mov 16:ss[bp+-28],dx
mov 16:ss[bp+-30],ax
push 16:ss[bp+-16]
push 16:ss[bp+-6]
callf $callD
pop cx
pop cx
mov 16:ss[bp+-32],dx
mov 16:ss[bp+-34],ax
push 16:ss[bp+-12]
push 16:ss[bp+-6]
callf $callD
pop cx
pop cx
mov 16:ss[bp+-36],dx
mov 16:ss[bp+-38],ax
push 16:ss[bp+-16]
push 16:ss[bp+-4]
callf $callD
pop cx
pop cx
mov 16:ss[bp+-40],dx
mov 16:ss[bp+-42],ax
push 16:ss[bp+-8]
push 16:ss[bp+-10]
mov ax,16:ss[bp+-28]
mov dx,16:ss[bp+-30]
add dx,16:ss[bp+-34]
adc ax,16:ss[bp+-32]
add dx,16:ss[bp+-34]
adc ax,16:ss[bp+-32]
sub dx,16:ss[bp+-38]
sbb ax,16:ss[bp+-36]
push ax
push dx
call $callE
mov 16:ss[bp+-12],ax
push 16:ss[bp+-8]
push 16:ss[bp+-10]
mov ax,16:ss[bp+-28]
mov dx,16:ss[bp+-30]
add dx,16:ss[bp+-30]
adc ax,16:ss[bp+-28]
add dx,16:ss[bp+-34]
adc ax,16:ss[bp+-32]
sub dx,16:ss[bp+-42]
sbb ax,16:ss[bp+-40]
push ax
push dx
call $callE
mov 16:ss[bp+-16],ax
xor ax,ax
sub ax,16:ss[bp+-2]
push ax
lea ax,16:ss[bp+-14]
push ax
lea ax,16:ss[bp+-12]
push ax
nop
push cs
call $callC
add sp,#6
xor ax,ax
sub ax,16:ss[bp+-2]
push ax
lea ax,16:ss[bp+-18]
push ax
lea ax,16:ss[bp+-16]
push ax
nop
push cs
call $callC
add sp,#6
mov ax,16:ss[bp+-12]
sar ax,#1
mov 16:ds[si+54],ax
mov ax,16:ss[bp+-14]
sar ax,#1
mov 16:ds[si+56],ax
mov ax,16:ss[bp+-16]
sar ax,#1
mov 16:ds[di+54],ax
mov ax,16:ss[bp+-18]
sar ax,#1
mov 16:ds[di+56],ax
mov 16:ss[bp+-26],#0
mov ax,16:ds[si+54]
cwd
xor ax,dx
sub ax,dx
cmp ax,#256
jge @labelGW
mov ax,16:ds[di+54]
cwd
xor ax,dx
sub ax,dx
cmp ax,#256
jge @labelGW
mov 16:ss[bp+-26],#1
labelGW: test 16:ds[si+6],#1
je @labelGZ
mov 16:ss[bp+-26],#1
labelGZ: mov ax,16:ds[si+54]
cwd
xor ax,dx
sub ax,dx
push ax
mov ax,16:ds[si+56]
cwd
xor ax,dx
sub ax,dx
pop dx
cmp dx,ax
jle @labelHM
mov 16:ss[bp+-26],#0
labelHM: test 16:ds[si+10],#16
je @labelHP
mov 16:ss[bp+-26],#1
labelHP: cmp 16:ss[bp+-26],#0
je @labelJH
mov 16:ss[bp+-24],#1024
mov ax,16:ds[si+68]
sar ax,#1
mov dx,16:ds[si+30]
add dx,ax
mov 16:ss[bp+-20],dx
mov ax,16:ds[di+68]
sar ax,#1
mov dx,16:ds[di+30]
add dx,ax
mov 16:ss[bp+-22],dx
mov ax,16:ss[bp+-20]
cmp ax,16:ss[bp+-22]
jge @labelIT
mov ax,16:ss[bp+-24]
neg ax
cmp 16:ds[si+54],ax
jle @labelIM
mov ax,16:ss[bp+-24]
neg ax
mov 16:ds[si+54],ax
labelIM: test 16:ds[si+10],#16
jne @labelJH
mov ax,16:ds[di+54]
cmp ax,16:ss[bp+-24]
jge @labelJH
mov ax,16:ss[bp+-24]
jmp @labelJG
labelIT: mov ax,16:ds[si+54]
cmp ax,16:ss[bp+-24]
jge @labelIY
mov ax,16:ss[bp+-24]
mov 16:ds[si+54],ax
labelIY: test 16:ds[si+10],#16
jne @labelJH
mov ax,16:ss[bp+-24]
neg ax
cmp 16:ds[di+54],ax
jle @labelJH
mov ax,16:ss[bp+-24]
neg ax
labelJG: mov 16:ds[di+54],ax
labelJH: push si
push cs
call $callF
pop cx
push di
push cs
call $callF
pop cx
mov ax,16:ds[si+30]
cwd
mov 16:ss[bp+-44],dx
mov 16:ss[bp+-46],ax
cmp 16:ds[si+54],#0
jl @labelKC
add ax,#1
adc dx,#0
mov cl,#9
call $callG
add ax,#65535
adc dx,#-1
jmp @labelKG
labelKC: mov dx,16:ss[bp+-44]
mov ax,16:ss[bp+-46]
mov cl,#9
call $callG
labelKG: mov 16:ds[si+24],dx
mov 16:ds[si+22],ax
mov ax,16:ds[si+32]
cwd
mov 16:ss[bp+-48],dx
mov 16:ss[bp+-50],ax
mov ax,16:ds[si+4]
mov dx,#58
imul dx
mov dx,#{tableSegment}
mov bx,ax
mov es,dx
cmp 16:es[bx+8],#0
jl @labelLD
mov dx,16:ss[bp+-48]
mov ax,16:ss[bp+-50]
add ax,#1
adc dx,#0
mov cl,#9
call $callG
add ax,#65535
adc dx,#-1
jmp @labelLH
labelLD: mov dx,16:ss[bp+-48]
mov ax,16:ss[bp+-50]
mov cl,#9
call $callG
labelLH: mov 16:ds[si+28],dx
mov 16:ds[si+26],ax
mov ax,16:ds[di+30]
cwd
mov 16:ss[bp+-44],dx
mov 16:ss[bp+-46],ax
cmp 16:ds[di+54],#0
jl @labelLW
add ax,#1
adc dx,#0
mov cl,#9
call $callG
add ax,#65535
adc dx,#-1
jmp @labelMA
labelLW: mov dx,16:ss[bp+-44]
mov ax,16:ss[bp+-46]
mov cl,#9
call $callG
labelMA: mov 16:ds[di+24],dx
mov 16:ds[di+22],ax
mov ax,16:ds[di+32]
cwd
mov 16:ss[bp+-48],dx
mov 16:ss[bp+-50],ax
mov ax,16:ds[di+4]
mov dx,#58
imul dx
mov dx,#{tableSegment}
mov bx,ax
mov es,dx
cmp 16:es[bx+8],#0
jl @labelMX
mov dx,16:ss[bp+-48]
mov ax,16:ss[bp+-50]
add ax,#1
adc dx,#0
mov cl,#9
call $callG
add ax,#65535
adc dx,#-1
jmp @labelNB
labelMX: mov dx,16:ss[bp+-48]
mov ax,16:ss[bp+-50]
mov cl,#9
call $callG
labelNB: mov 16:ds[di+28],dx
mov 16:ds[di+26],ax
pop di
pop si
mov sp,bp
pop bp
retf`,
  },
  {
    kind: "reflection",
    pattern: `push bp
mov bp,sp
sub sp,#24
push si
push di
mov si,16:ss[bp+6]
push si
push cs
call $callA
pop cx
mov ax,si
add ax,#132
mov 16:ss[bp+-20],ax
mov bx,16:ss[bp+-20]
mov ax,16:ds[bx+0]
mov 16:ss[bp+-18],ax
mov ax,16:ds[si+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-22],ax
mov bx,16:ss[bp+-18]
mov ax,16:ds[bx+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-24],ax
mov bx,16:ss[bp+-20]
mov di,16:ds[bx+4]
or di,di
je @labelBH
cmp di,#32768
jne @labelBU
labelBH: mov bx,16:ss[bp+-20]
mov al,8:ds[bx+2]
mov ah,#0
or ax,ax
jne @labelBO
add di,#4096
jmp @labelBU
labelBO: mov bx,16:ss[bp+-20]
mov al,8:ds[bx+3]
mov ah,#0
or ax,ax
jne @labelBU
sub di,#4096
labelBU: mov ax,16:ds[si+54]
mov 16:ss[bp+-2],ax
mov ax,16:ds[si+56]
mov 16:ss[bp+-4],ax
push di
lea ax,16:ss[bp+-4]
push ax
lea ax,16:ss[bp+-2]
push ax
nop
push cs
call $callB
add sp,#6
mov bx,16:ss[bp+-22]
mov ax,16:ds[bx+4]
mov bx,16:ss[bp+-24]
cmp ax,16:ds[bx+4]
jge @labelCP
mov bx,16:ss[bp+-22]
mov ax,16:ds[bx+4]
jmp @labelCR
labelCP: mov bx,16:ss[bp+-24]
mov ax,16:ds[bx+4]
labelCR: mov 16:ss[bp+-8],ax
push 16:ss[bp+-8]
push 16:ss[bp+-4]
callf $callC
pop cx
pop cx
mov 16:ss[bp+-14],dx
mov 16:ss[bp+-16],ax
mov dx,16:ss[bp+-14]
mov ax,16:ss[bp+-16]
mov cl,#8
call $callD
mov 16:ss[bp+-4],ax
xor ax,ax
sub ax,16:ss[bp+-4]
mov 16:ss[bp+-4],ax
cmp 16:ss[bp+-4],#0
jge @labelDT
mov ax,16:ss[bp+-4]
add ax,#64
mov 16:ss[bp+-6],ax
cmp 16:ss[bp+-6],#0
jge @labelDR
mov ax,16:ss[bp+-6]
mov 16:ss[bp+-4],ax
jmp @labelDS
labelDR: mov 16:ss[bp+-4],#0
labelDS: jmp @labelEC
labelDT: mov ax,16:ss[bp+-4]
add ax,#65472
mov 16:ss[bp+-6],ax
cmp 16:ss[bp+-6],#0
jle @labelEB
mov ax,16:ss[bp+-6]
mov 16:ss[bp+-4],ax
jmp @labelEC
labelEB: mov 16:ss[bp+-4],#0
labelEC: xor ax,ax
sub ax,di
push ax
lea ax,16:ss[bp+-4]
push ax
lea ax,16:ss[bp+-2]
push ax
nop
push cs
call $callB
add sp,#6
mov ax,16:ss[bp+-2]
mov 16:ds[si+54],ax
mov ax,16:ss[bp+-4]
mov 16:ds[si+56],ax
push si
push cs
call $callE
pop cx
mov ax,16:ds[si+30]
cwd
mov 16:ss[bp+-10],dx
mov 16:ss[bp+-12],ax
cmp 16:ss[bp+-2],#0
jl @labelFK
mov dx,16:ss[bp+-10]
mov ax,16:ss[bp+-12]
add ax,#1
adc dx,#0
mov cl,#9
call $callF
add ax,#65535
adc dx,#-1
jmp @labelFO
labelFK: mov dx,16:ss[bp+-10]
mov ax,16:ss[bp+-12]
mov cl,#9
call $callF
labelFO: mov 16:ds[si+24],dx
mov 16:ds[si+22],ax
mov ax,16:ds[si+32]
cwd
mov 16:ss[bp+-14],dx
mov 16:ss[bp+-16],ax
mov bx,16:ss[bp+-22]
cmp 16:ds[bx+8],#0
jl @labelGG
mov dx,16:ss[bp+-14]
mov ax,16:ss[bp+-16]
add ax,#1
adc dx,#0
mov cl,#9
call $callF
add ax,#65535
adc dx,#-1
jmp @labelGK
labelGG: mov dx,16:ss[bp+-14]
mov ax,16:ss[bp+-16]
mov cl,#9
call $callF
labelGK: mov 16:ds[si+28],dx
mov 16:ds[si+26],ax
pop di
pop si
mov sp,bp
pop bp
retf`,
  },
  {
    kind: "exchange",
    pattern: `push bp
mov bp,sp
sub sp,#54
push si
push di
mov si,16:ss[bp+6]
push si
push cs
call $callA
pop cx
mov di,16:ds[si+132]
or 16:ds[si+6],#8
or 16:ds[di+6],#8
mov ax,16:ds[si+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-52],ax
mov ax,16:ds[di+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-54],ax
mov bx,16:ss[bp+-52]
mov ax,16:ds[bx+4]
mov bx,16:ss[bp+-54]
cmp ax,16:ds[bx+4]
jge @labelBF
mov bx,16:ss[bp+-52]
mov ax,16:ds[bx+4]
jmp @labelBH
labelBF: mov bx,16:ss[bp+-54]
mov ax,16:ds[bx+4]
labelBH: mov 16:ss[bp+-4],ax
mov bx,16:ss[bp+-52]
mov ax,16:ds[bx+2]
mov 16:ss[bp+-6],ax
mov bx,16:ss[bp+-54]
mov ax,16:ds[bx+2]
mov 16:ss[bp+-8],ax
mov ax,16:ds[si+54]
mov 16:ss[bp+-14],ax
mov ax,16:ds[si+56]
mov 16:ss[bp+-16],ax
mov ax,16:ds[di+54]
mov 16:ss[bp+-18],ax
mov ax,16:ds[di+56]
mov 16:ss[bp+-20],ax
push di
push si
nop
push cs
call $callB
pop cx
pop cx
mov 16:ss[bp+-2],ax
sub 16:ss[bp+-2],#16384
push 16:ss[bp+-2]
lea ax,16:ss[bp+-16]
push ax
lea ax,16:ss[bp+-14]
push ax
nop
push cs
call $callC
add sp,#6
push 16:ss[bp+-2]
lea ax,16:ss[bp+-20]
push ax
lea ax,16:ss[bp+-18]
push ax
nop
push cs
call $callC
add sp,#6
mov ax,16:ss[bp+-6]
cwd
mov 16:ss[bp+-10],dx
mov 16:ss[bp+-12],ax
mov ax,16:ss[bp+-8]
cwd
add 16:ss[bp+-12],ax
adc 16:ss[bp+-10],dx
push 16:ss[bp+-14]
push 16:ss[bp+-6]
callf $callD
pop cx
pop cx
mov 16:ss[bp+-28],dx
mov 16:ss[bp+-30],ax
push 16:ss[bp+-18]
push 16:ss[bp+-8]
callf $callD
pop cx
pop cx
mov 16:ss[bp+-32],dx
mov 16:ss[bp+-34],ax
push 16:ss[bp+-14]
push 16:ss[bp+-8]
callf $callD
pop cx
pop cx
mov 16:ss[bp+-36],dx
mov 16:ss[bp+-38],ax
push 16:ss[bp+-18]
push 16:ss[bp+-6]
callf $callD
pop cx
pop cx
mov 16:ss[bp+-40],dx
mov 16:ss[bp+-42],ax
push 16:ss[bp+-10]
push 16:ss[bp+-12]
mov ax,16:ss[bp+-28]
mov dx,16:ss[bp+-30]
add dx,16:ss[bp+-34]
adc ax,16:ss[bp+-32]
add dx,16:ss[bp+-34]
adc ax,16:ss[bp+-32]
sub dx,16:ss[bp+-38]
sbb ax,16:ss[bp+-36]
push ax
push dx
call $callE
mov 16:ss[bp+-14],ax
push 16:ss[bp+-10]
push 16:ss[bp+-12]
mov ax,16:ss[bp+-28]
mov dx,16:ss[bp+-30]
add dx,16:ss[bp+-30]
adc ax,16:ss[bp+-28]
add dx,16:ss[bp+-34]
adc ax,16:ss[bp+-32]
sub dx,16:ss[bp+-42]
sbb ax,16:ss[bp+-40]
push ax
push dx
call $callE
mov 16:ss[bp+-18],ax
xor ax,ax
sub ax,16:ss[bp+-2]
push ax
lea ax,16:ss[bp+-16]
push ax
lea ax,16:ss[bp+-14]
push ax
nop
push cs
call $callC
add sp,#6
xor ax,ax
sub ax,16:ss[bp+-2]
push ax
lea ax,16:ss[bp+-20]
push ax
lea ax,16:ss[bp+-18]
push ax
nop
push cs
call $callC
add sp,#6
mov ax,16:ss[bp+-14]
sar ax,#1
mov 16:ds[si+54],ax
mov ax,16:ss[bp+-16]
sar ax,#1
mov 16:ds[si+56],ax
mov ax,16:ss[bp+-18]
sar ax,#1
mov 16:ds[di+54],ax
mov ax,16:ss[bp+-20]
sar ax,#1
mov 16:ds[di+56],ax
mov 16:ss[bp+-26],#0
mov ax,16:ds[si+54]
cwd
xor ax,dx
sub ax,dx
cmp ax,#256
jge @labelHF
mov ax,16:ds[di+54]
cwd
xor ax,dx
sub ax,dx
cmp ax,#256
jge @labelHF
mov 16:ss[bp+-26],#1
labelHF: test 16:ds[si+6],#1
je @labelHI
mov 16:ss[bp+-26],#1
labelHI: test 16:ds[si+10],#16
je @labelHL
mov 16:ss[bp+-26],#1
labelHL: cmp 16:ss[bp+-26],#0
je @labelIR
mov ax,16:ds[si+68]
sar ax,#1
mov dx,16:ds[si+30]
add dx,ax
mov 16:ss[bp+-22],dx
mov ax,16:ds[di+68]
sar ax,#1
mov dx,16:ds[di+30]
add dx,ax
mov 16:ss[bp+-24],dx
mov ax,16:ss[bp+-22]
cmp ax,16:ss[bp+-24]
jge @labelIJ
cmp 16:ds[si+54],#65024
jle @labelID
mov 16:ds[si+54],#65024
labelID: test 16:ds[si+10],#16
jne @labelII
cmp 16:ds[di+54],#512
jge @labelII
mov 16:ds[di+54],#512
labelII: jmp @labelIR
labelIJ: cmp 16:ds[si+54],#512
jge @labelIM
mov 16:ds[si+54],#512
labelIM: test 16:ds[si+10],#16
jne @labelIR
cmp 16:ds[di+54],#65024
jle @labelIR
mov 16:ds[di+54],#65024
labelIR: push si
push cs
call $callF
pop cx
push di
push cs
call $callF
pop cx
mov ax,16:ds[si+30]
cwd
mov 16:ss[bp+-44],dx
mov 16:ss[bp+-46],ax
cmp 16:ds[si+54],#0
jl @labelJO
mov dx,16:ss[bp+-44]
mov ax,16:ss[bp+-46]
add ax,#1
adc dx,#0
mov cl,#9
call $callG
add ax,#65535
adc dx,#-1
jmp @labelJS
labelJO: mov dx,16:ss[bp+-44]
mov ax,16:ss[bp+-46]
mov cl,#9
call $callG
labelJS: mov 16:ds[si+24],dx
mov 16:ds[si+22],ax
mov ax,16:ds[si+32]
cwd
mov 16:ss[bp+-48],dx
mov 16:ss[bp+-50],ax
mov ax,16:ds[si+4]
mov dx,#58
imul dx
mov bx,ax
cmp 16:ds[bx+{tableVertical}],#0
jl @labelKN
mov dx,16:ss[bp+-48]
mov ax,16:ss[bp+-50]
add ax,#1
adc dx,#0
mov cl,#9
call $callG
add ax,#65535
adc dx,#-1
jmp @labelKR
labelKN: mov dx,16:ss[bp+-48]
mov ax,16:ss[bp+-50]
mov cl,#9
call $callG
labelKR: mov 16:ds[si+28],dx
mov 16:ds[si+26],ax
mov ax,16:ds[di+30]
cwd
mov 16:ss[bp+-44],dx
mov 16:ss[bp+-46],ax
cmp 16:ds[di+54],#0
jl @labelLI
mov dx,16:ss[bp+-44]
mov ax,16:ss[bp+-46]
add ax,#1
adc dx,#0
mov cl,#9
call $callG
add ax,#65535
adc dx,#-1
jmp @labelLM
labelLI: mov dx,16:ss[bp+-44]
mov ax,16:ss[bp+-46]
mov cl,#9
call $callG
labelLM: mov 16:ds[di+24],dx
mov 16:ds[di+22],ax
mov ax,16:ds[di+32]
cwd
mov 16:ss[bp+-48],dx
mov 16:ss[bp+-50],ax
mov ax,16:ds[di+4]
mov dx,#58
imul dx
mov bx,ax
cmp 16:ds[bx+{tableVertical}],#0
jl @labelMH
mov dx,16:ss[bp+-48]
mov ax,16:ss[bp+-50]
add ax,#1
adc dx,#0
mov cl,#9
call $callG
add ax,#65535
adc dx,#-1
jmp @labelML
labelMH: mov dx,16:ss[bp+-48]
mov ax,16:ss[bp+-50]
mov cl,#9
call $callG
labelML: mov 16:ds[di+28],dx
mov 16:ds[di+26],ax
pop di
pop si
mov sp,bp
pop bp
retf`,
  },
];

export const centreAnglePatterns = [
  `push bp
mov bp,sp
sub sp,#18
push si
push di
mov si,16:ss[bp+6]
mov di,16:ss[bp+8]
mov ax,16:ds[si+68]
sar ax,#1
mov dx,16:ds[si+30]
add dx,ax
mov 16:ss[bp+-2],dx
mov ax,16:ds[si+70]
sar ax,#1
mov dx,16:ds[si+32]
add dx,ax
mov 16:ss[bp+-4],dx
mov ax,16:ds[di+68]
sar ax,#1
mov dx,16:ds[di+30]
add dx,ax
mov 16:ss[bp+-6],dx
mov ax,16:ds[di+70]
sar ax,#1
mov dx,16:ds[di+32]
add dx,ax
mov 16:ss[bp+-8],dx
mov ax,16:ss[bp+-2]
sub ax,16:ss[bp+-6]
cwd
mov 16:ss[bp+-12],dx
mov 16:ss[bp+-14],ax
mov ax,16:ss[bp+-8]
sub ax,16:ss[bp+-4]
cwd
mov 16:ss[bp+-16],dx
mov 16:ss[bp+-18],ax
push 16:ss[bp+-16]
push ax
push 16:ss[bp+-12]
push 16:ss[bp+-14]
callf $angle
add sp,#8
mov 16:ss[bp+-10],ax
pop di
pop si
mov sp,bp
pop bp
retf`,
  `push bp
mov bp,sp
sub sp,#18
push si
push di
mov si,16:ss[bp+6]
mov di,16:ss[bp+8]
mov ax,16:ds[si+68]
sar ax,#1
mov dx,16:ds[si+30]
add dx,ax
mov 16:ss[bp+-2],dx
mov ax,16:ds[si+70]
sar ax,#1
mov dx,16:ds[si+32]
add dx,ax
mov 16:ss[bp+-4],dx
mov ax,16:ds[di+68]
sar ax,#1
mov dx,16:ds[di+30]
add dx,ax
mov 16:ss[bp+-6],dx
mov ax,16:ds[di+70]
sar ax,#1
mov dx,16:ds[di+32]
add dx,ax
mov 16:ss[bp+-8],dx
mov ax,16:ss[bp+-2]
sub ax,16:ss[bp+-6]
cwd
mov 16:ss[bp+-12],dx
mov 16:ss[bp+-14],ax
mov ax,16:ss[bp+-8]
sub ax,16:ss[bp+-4]
cwd
mov 16:ss[bp+-16],dx
mov 16:ss[bp+-18],ax
push 16:ss[bp+-16]
push 16:ss[bp+-18]
push 16:ss[bp+-12]
push 16:ss[bp+-14]
callf $angle
add sp,#8
mov 16:ss[bp+-10],ax
mov ax,16:ss[bp+-10]
jmp @labelBU
labelBU: pop di
pop si
mov sp,bp
pop bp
retf`,
  `push bp
mov bp,sp
sub sp,#18
push si
push di
mov si,16:ss[bp+6]
mov di,16:ss[bp+8]
mov ax,16:ds[si+68]
sar ax,#1
mov dx,16:ds[si+30]
add dx,ax
mov 16:ss[bp+-2],dx
mov ax,16:ds[si+70]
sar ax,#1
mov dx,16:ds[si+32]
add dx,ax
mov 16:ss[bp+-4],dx
mov ax,16:ds[di+68]
sar ax,#1
mov dx,16:ds[di+30]
add dx,ax
mov 16:ss[bp+-6],dx
mov ax,16:ds[di+70]
sar ax,#1
mov dx,16:ds[di+32]
add dx,ax
mov 16:ss[bp+-8],dx
mov ax,16:ss[bp+-2]
sub ax,16:ss[bp+-6]
cwd
mov 16:ss[bp+-12],dx
mov 16:ss[bp+-14],ax
mov ax,16:ss[bp+-8]
sub ax,16:ss[bp+-4]
cwd
mov 16:ss[bp+-16],dx
mov 16:ss[bp+-18],ax
push dx
push ax
push 16:ss[bp+-12]
push 16:ss[bp+-14]
callf $angle
add sp,#8
mov 16:ss[bp+-10],ax
pop di
pop si
mov sp,bp
pop bp
retf`,
];
