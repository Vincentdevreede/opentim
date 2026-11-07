/** Instruction-graph patterns of the part copy, one per compiler form found in the supplied builds. */

/** Complete compiler forms of the part copy: copies a part into fresh memory with its own belt, rope and outline records. */
export const partCopyPatterns = [
  `push bp
mov bp,sp
sub sp,#8
push si
push di
mov di,16:ss[bp+6]
mov 16:ss[bp+-4],#0
mov ax,#162
push ax
mov ax,#1
push ax
nop
push cs
call $allocate
pop cx
pop cx
mov si,ax
or ax,ax
jne @LB
LA: mov 16:ss[bp+-4],#1
jmp @LL
LB: mov ax,16:ds[di+4]
mov 16:ds[si+4],ax
mov ax,16:ds[di+6]
mov 16:ds[si+6],ax
mov ax,16:ds[di+8]
mov 16:ds[si+8],ax
mov ax,16:ds[di+10]
mov 16:ds[si+10],ax
mov ax,16:ds[di+12]
mov 16:ds[si+12],ax
mov ax,16:ds[di+14]
mov 16:ds[si+14],ax
mov ax,16:ds[di+16]
mov 16:ds[si+16],ax
mov ax,16:ds[di+18]
mov 16:ds[si+18],ax
mov ax,16:ds[di+66]
mov dx,16:ds[di+64]
mov 16:ds[si+66],ax
mov 16:ds[si+64],dx
mov ax,16:ds[di+70]
mov dx,16:ds[di+68]
mov 16:ds[si+70],ax
mov 16:ds[si+68],dx
mov ax,16:ds[di+82]
mov dx,16:ds[di+80]
mov 16:ds[si+82],ax
mov 16:ds[si+80],dx
cmp 16:ds[si+4],#8
jne @LD
mov ax,#56
push ax
mov ax,#1
push ax
nop
push cs
call $allocate
pop cx
pop cx
mov 16:ds[si+84],ax
or ax,ax
jne @LC
jmp @LA
LC: mov bx,16:ds[si+84]
mov 16:ds[bx+2],si
LD: mov ax,16:ds[di+86]
mov 16:ds[si+86],ax
mov ax,16:ds[di+88]
mov 16:ds[si+88],ax
cmp 16:ds[si+4],#10
je @LE
cmp 16:ds[si+4],#7
jne @LG
LE: mov ax,#44
push ax
mov ax,#1
push ax
nop
push cs
call $allocate
pop cx
pop cx
mov 16:ds[si+102],ax
or ax,ax
jne @LF
jmp @LA
LF: mov bx,16:ds[si+102]
mov 16:ds[bx+0],si
LG: mov ax,16:ds[di+106]
mov 16:ds[si+106],ax
mov ax,16:ds[di+108]
mov 16:ds[si+108],ax
mov ax,16:ds[di+4]
mov dx,#58
imul dx
mov dx,#{table}
mov bx,ax
mov es,dx
mov ax,16:es[bx+30]
mov 16:ds[si+128],ax
or ax,ax
je @LK
mov ax,16:ds[di+130]
mov 16:ss[bp+-8],ax
mov ax,#4
push ax
push 16:ds[si+128]
nop
push cs
call $allocate
pop cx
pop cx
mov 16:ds[si+130],ax
mov 16:ss[bp+-6],ax
cmp 16:ss[bp+-6],#0
jne @LH
jmp @LA
LH: mov 16:ss[bp+-2],#0
jmp @LJ
LI: mov bx,16:ss[bp+-8]
mov ax,16:ds[bx+2]
mov dx,16:ds[bx+0]
mov bx,16:ss[bp+-6]
mov 16:ds[bx+2],ax
mov 16:ds[bx+0],dx
inc 16:ss[bp+-2]
add 16:ss[bp+-6],#4
add 16:ss[bp+-8],#4
LJ: mov ax,16:ds[si+128]
cmp ax,16:ss[bp+-2]
jg @LI
LK: mov ax,16:ds[di+144]
mov 16:ds[si+144],ax
mov ax,16:ds[di+146]
mov 16:ds[si+146],ax
mov ax,16:ds[di+148]
mov 16:ds[si+148],ax
LL: cmp 16:ss[bp+-4],#0
je @LM
push si
callf $release
pop cx
xor ax,ax
jmp @LN
LM: mov ax,si
LN: pop di
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
mov 16:ss[bp+-4],#0
mov ax,#162
push ax
mov ax,#1
push ax
callf $allocate
pop cx
pop cx
mov si,ax
or ax,ax
jne @LB
LA: mov 16:ss[bp+-4],#1
jmp @LL
LB: mov ax,16:ds[di+4]
mov 16:ds[si+4],ax
mov ax,16:ds[di+6]
mov 16:ds[si+6],ax
mov ax,16:ds[di+8]
mov 16:ds[si+8],ax
mov ax,16:ds[di+10]
mov 16:ds[si+10],ax
mov ax,16:ds[di+12]
mov 16:ds[si+12],ax
mov ax,16:ds[di+14]
mov 16:ds[si+14],ax
mov ax,16:ds[di+16]
mov 16:ds[si+16],ax
mov ax,16:ds[di+18]
mov 16:ds[si+18],ax
mov ax,16:ds[di+66]
mov dx,16:ds[di+64]
mov 16:ds[si+66],ax
mov 16:ds[si+64],dx
mov ax,16:ds[di+70]
mov dx,16:ds[di+68]
mov 16:ds[si+70],ax
mov 16:ds[si+68],dx
mov ax,16:ds[di+82]
mov dx,16:ds[di+80]
mov 16:ds[si+82],ax
mov 16:ds[si+80],dx
cmp 16:ds[si+4],#8
jne @LD
mov ax,#56
push ax
mov ax,#1
push ax
callf $allocate
pop cx
pop cx
mov 16:ds[si+84],ax
or ax,ax
jne @LC
jmp @LA
LC: mov bx,16:ds[si+84]
mov 16:ds[bx+2],si
LD: mov ax,16:ds[di+86]
mov 16:ds[si+86],ax
mov ax,16:ds[di+88]
mov 16:ds[si+88],ax
cmp 16:ds[si+4],#10
je @LE
cmp 16:ds[si+4],#7
jne @LG
LE: mov ax,#44
push ax
mov ax,#1
push ax
callf $allocate
pop cx
pop cx
mov 16:ds[si+102],ax
or ax,ax
jne @LF
jmp @LA
LF: mov bx,16:ds[si+102]
mov 16:ds[bx+0],si
LG: mov ax,16:ds[di+106]
mov 16:ds[si+106],ax
mov ax,16:ds[di+108]
mov 16:ds[si+108],ax
mov ax,16:ds[di+4]
mov dx,#58
imul dx
mov dx,#{table}
mov bx,ax
mov es,dx
mov ax,16:es[bx+30]
mov 16:ds[si+128],ax
or ax,ax
je @LK
mov ax,16:ds[di+130]
mov 16:ss[bp+-8],ax
mov ax,#4
push ax
push 16:ds[si+128]
callf $allocate
pop cx
pop cx
mov 16:ds[si+130],ax
mov 16:ss[bp+-6],ax
cmp 16:ss[bp+-6],#0
jne @LH
jmp @LA
LH: mov 16:ss[bp+-2],#0
jmp @LJ
LI: mov bx,16:ss[bp+-8]
mov ax,16:ds[bx+2]
mov dx,16:ds[bx+0]
mov bx,16:ss[bp+-6]
mov 16:ds[bx+2],ax
mov 16:ds[bx+0],dx
inc 16:ss[bp+-2]
add 16:ss[bp+-6],#4
add 16:ss[bp+-8],#4
LJ: mov ax,16:ds[si+128]
cmp ax,16:ss[bp+-2]
jg @LI
LK: mov ax,16:ds[di+144]
mov 16:ds[si+144],ax
mov ax,16:ds[di+146]
mov 16:ds[si+146],ax
mov ax,16:ds[di+148]
mov 16:ds[si+148],ax
LL: cmp 16:ss[bp+-4],#0
je @LN
push si
callf $release
pop cx
xor ax,ax
LM: jmp @LO
LN: mov ax,si
jmp @LM
LO: pop di
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
mov 16:ss[bp+-4],#0
mov ax,#162
push ax
mov ax,#1
push ax
nop
push cs
call $allocate
pop cx
pop cx
mov si,ax
or ax,ax
jne @LB
LA: mov 16:ss[bp+-4],#1
jmp @LL
LB: mov ax,16:ds[di+4]
mov 16:ds[si+4],ax
mov ax,16:ds[di+6]
mov 16:ds[si+6],ax
mov ax,16:ds[di+8]
mov 16:ds[si+8],ax
mov ax,16:ds[di+10]
mov 16:ds[si+10],ax
mov ax,16:ds[di+12]
mov 16:ds[si+12],ax
mov ax,16:ds[di+14]
mov 16:ds[si+14],ax
mov ax,16:ds[di+16]
mov 16:ds[si+16],ax
mov ax,16:ds[di+18]
mov 16:ds[si+18],ax
mov ax,16:ds[di+66]
mov dx,16:ds[di+64]
mov 16:ds[si+66],ax
mov 16:ds[si+64],dx
mov ax,16:ds[di+70]
mov dx,16:ds[di+68]
mov 16:ds[si+70],ax
mov 16:ds[si+68],dx
mov ax,16:ds[di+82]
mov dx,16:ds[di+80]
mov 16:ds[si+82],ax
mov 16:ds[si+80],dx
cmp 16:ds[si+4],#8
jne @LD
mov ax,#56
push ax
mov ax,#1
push ax
nop
push cs
call $allocate
pop cx
pop cx
mov 16:ds[si+84],ax
or ax,ax
jne @LC
jmp @LA
LC: mov bx,16:ds[si+84]
mov 16:ds[bx+2],si
LD: mov ax,16:ds[di+86]
mov 16:ds[si+86],ax
mov ax,16:ds[di+88]
mov 16:ds[si+88],ax
cmp 16:ds[si+4],#10
je @LE
cmp 16:ds[si+4],#7
jne @LG
LE: mov ax,#44
push ax
mov ax,#1
push ax
nop
push cs
call $allocate
pop cx
pop cx
mov 16:ds[si+102],ax
or ax,ax
jne @LF
jmp @LA
LF: mov bx,16:ds[si+102]
mov 16:ds[bx+0],si
LG: mov ax,16:ds[di+106]
mov 16:ds[si+106],ax
mov ax,16:ds[di+108]
mov 16:ds[si+108],ax
mov ax,16:ds[di+4]
mov dx,#58
imul dx
mov bx,ax
mov ax,16:ds[bx+{table}]
mov 16:ds[si+128],ax
or ax,ax
je @LK
mov ax,16:ds[di+130]
mov 16:ss[bp+-8],ax
mov ax,#4
push ax
push 16:ds[si+128]
nop
push cs
call $allocate
pop cx
pop cx
mov 16:ds[si+130],ax
mov 16:ss[bp+-6],ax
cmp 16:ss[bp+-6],#0
jne @LH
jmp @LA
LH: mov 16:ss[bp+-2],#0
jmp @LJ
LI: mov bx,16:ss[bp+-8]
mov ax,16:ds[bx+2]
mov dx,16:ds[bx+0]
mov bx,16:ss[bp+-6]
mov 16:ds[bx+2],ax
mov 16:ds[bx+0],dx
inc 16:ss[bp+-2]
add 16:ss[bp+-6],#4
add 16:ss[bp+-8],#4
LJ: mov ax,16:ds[si+128]
cmp ax,16:ss[bp+-2]
jg @LI
LK: mov ax,16:ds[di+144]
mov 16:ds[si+144],ax
mov ax,16:ds[di+146]
mov 16:ds[si+146],ax
mov ax,16:ds[di+148]
mov 16:ds[si+148],ax
LL: cmp 16:ss[bp+-4],#0
je @LN
push si
callf $release
pop cx
xor ax,ax
LM: jmp @LO
LN: mov ax,si
jmp @LM
LO: pop di
pop si
mov sp,bp
pop bp
retf`,
];
