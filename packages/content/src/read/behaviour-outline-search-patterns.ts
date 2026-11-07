/** Instruction-graph patterns of the outline search, one per compiler form found in the supplied builds. */

/** Complete compiler forms of the outline search: lists every part with an outline edge crossing the given shape. */
export const outlineSearchPatterns = [
  `push bp
mov bp,sp
sub sp,#26
push si
push di
mov bx,16:ss[bp+6]
mov 16:ds[bx+120],#0
push 16:ss[bp+8]
nop
push cs
call $listHead
pop cx
jmp @LH
LA: mov 16:ss[bp+-2],#1
mov di,16:ds[si+130]
mov al,8:ds[di+0]
mov ah,#0
mov dx,16:ds[si+30]
add dx,ax
mov 16:ss[bp+-4],dx
mov ax,dx
mov 16:ss[bp+-8],ax
mov al,8:ds[di+1]
mov ah,#0
mov dx,16:ds[si+32]
add dx,ax
mov 16:ss[bp+-10],dx
mov ax,dx
mov 16:ss[bp+-14],ax
jmp @LE
LB: mov bx,16:ss[bp+6]
mov ax,16:ss[bp+-4]
sub ax,16:ds[bx+30]
mov 16:ss[bp+-22],ax
mov ax,16:ss[bp+-10]
sub ax,16:ds[bx+32]
mov 16:ss[bp+-20],ax
mov ax,16:ss[bp+-6]
sub ax,16:ds[bx+30]
mov 16:ss[bp+-18],ax
mov ax,16:ss[bp+-12]
sub ax,16:ds[bx+32]
mov 16:ss[bp+-16],ax
lea ax,16:ss[bp+-26]
push ax
lea ax,16:ss[bp+-22]
push ax
push 16:ss[bp+10]
nop
push cs
call $segments
add sp,#6
or ax,ax
je @LC
mov bx,16:ss[bp+6]
mov ax,16:ds[bx+120]
mov 16:ds[si+120],ax
mov 16:ds[bx+120],si
mov ax,16:ds[si+128]
mov 16:ss[bp+-2],ax
LC: inc 16:ss[bp+-2]
mov ax,16:ds[si+128]
cmp ax,16:ss[bp+-2]
jge @LD
xor di,di
jmp @LF
LD: add di,#4
mov ax,16:ss[bp+-6]
mov 16:ss[bp+-4],ax
mov ax,16:ss[bp+-12]
mov 16:ss[bp+-10],ax
mov ax,16:ds[si+128]
cmp ax,16:ss[bp+-2]
jne @LE
mov ax,16:ss[bp+-8]
mov 16:ss[bp+-6],ax
mov ax,16:ss[bp+-14]
mov 16:ss[bp+-12],ax
jmp @LF
LE: mov al,8:ds[di+4]
mov ah,#0
mov dx,16:ds[si+30]
add dx,ax
mov 16:ss[bp+-6],dx
mov al,8:ds[di+5]
mov ah,#0
mov dx,16:ds[si+32]
add dx,ax
mov 16:ss[bp+-12],dx
LF: or di,di
je @LG
jmp @LB
LG: mov ax,16:ss[bp+8]
and ax,#4096
push ax
push si
nop
push cs
call $listNext
pop cx
pop cx
LH: mov si,ax
or si,si
je @LI
jmp @LA
LI: pop di
pop si
mov sp,bp
pop bp
retf`,
  `push bp
mov bp,sp
sub sp,#26
push si
push di
mov bx,16:ss[bp+6]
mov 16:ds[bx+120],#0
push 16:ss[bp+8]
nop
push cs
call $listHead
pop cx
jmp @LH
LA: mov 16:ss[bp+-2],#1
mov di,16:ds[si+130]
mov al,8:ds[di+0]
mov ah,#0
mov dx,16:ds[si+30]
add dx,ax
mov 16:ss[bp+-4],dx
mov ax,dx
mov 16:ss[bp+-8],ax
mov al,8:ds[di+1]
mov ah,#0
mov dx,16:ds[si+32]
add dx,ax
mov 16:ss[bp+-10],dx
mov ax,dx
mov 16:ss[bp+-14],ax
mov al,8:ds[di+4]
mov ah,#0
mov dx,16:ds[si+30]
add dx,ax
mov 16:ss[bp+-6],dx
mov al,8:ds[di+5]
mov ah,#0
mov dx,16:ds[si+32]
add dx,ax
mov 16:ss[bp+-12],dx
jmp @LF
LB: mov bx,16:ss[bp+6]
mov ax,16:ss[bp+-4]
sub ax,16:ds[bx+30]
mov 16:ss[bp+-22],ax
mov bx,16:ss[bp+6]
mov ax,16:ss[bp+-10]
sub ax,16:ds[bx+32]
mov 16:ss[bp+-20],ax
mov bx,16:ss[bp+6]
mov ax,16:ss[bp+-6]
sub ax,16:ds[bx+30]
mov 16:ss[bp+-18],ax
mov bx,16:ss[bp+6]
mov ax,16:ss[bp+-12]
sub ax,16:ds[bx+32]
mov 16:ss[bp+-16],ax
lea ax,16:ss[bp+-26]
push ax
lea ax,16:ss[bp+-22]
push ax
push 16:ss[bp+10]
nop
push cs
call $segments
add sp,#6
or ax,ax
je @LC
mov bx,16:ss[bp+6]
mov ax,16:ds[bx+120]
mov 16:ds[si+120],ax
mov bx,16:ss[bp+6]
mov 16:ds[bx+120],si
mov ax,16:ds[si+128]
mov 16:ss[bp+-2],ax
LC: inc 16:ss[bp+-2]
mov ax,16:ds[si+128]
cmp ax,16:ss[bp+-2]
jge @LD
xor di,di
jmp @LF
LD: add di,#4
mov ax,16:ss[bp+-6]
mov 16:ss[bp+-4],ax
mov ax,16:ss[bp+-12]
mov 16:ss[bp+-10],ax
mov ax,16:ds[si+128]
cmp ax,16:ss[bp+-2]
jne @LE
mov ax,16:ss[bp+-8]
mov 16:ss[bp+-6],ax
mov ax,16:ss[bp+-14]
mov 16:ss[bp+-12],ax
jmp @LF
LE: mov al,8:ds[di+4]
mov ah,#0
mov dx,16:ds[si+30]
add dx,ax
mov 16:ss[bp+-6],dx
mov al,8:ds[di+5]
mov ah,#0
mov dx,16:ds[si+32]
add dx,ax
mov 16:ss[bp+-12],dx
LF: or di,di
je @LG
jmp @LB
LG: mov ax,16:ss[bp+8]
and ax,#4096
push ax
push si
nop
push cs
call $listNext
pop cx
pop cx
LH: mov si,ax
or si,si
je @LI
jmp @LA
LI: pop di
pop si
mov sp,bp
pop bp
retf`,
  `push bp
mov bp,sp
sub sp,#26
push si
push di
mov bx,16:ss[bp+6]
mov 16:ds[bx+120],#0
push 16:ss[bp+8]
callf $listHead
pop cx
jmp @LH
LA: mov 16:ss[bp+-2],#1
mov di,16:ds[si+130]
mov al,8:ds[di+0]
mov ah,#0
mov dx,16:ds[si+30]
add dx,ax
mov 16:ss[bp+-4],dx
mov ax,dx
mov 16:ss[bp+-8],ax
mov al,8:ds[di+1]
mov ah,#0
mov dx,16:ds[si+32]
add dx,ax
mov 16:ss[bp+-10],dx
mov ax,dx
mov 16:ss[bp+-14],ax
mov al,8:ds[di+4]
mov ah,#0
mov dx,16:ds[si+30]
add dx,ax
mov 16:ss[bp+-6],dx
mov al,8:ds[di+5]
mov ah,#0
mov dx,16:ds[si+32]
add dx,ax
mov 16:ss[bp+-12],dx
jmp @LF
LB: mov bx,16:ss[bp+6]
mov ax,16:ss[bp+-4]
sub ax,16:ds[bx+30]
mov 16:ss[bp+-22],ax
mov bx,16:ss[bp+6]
mov ax,16:ss[bp+-10]
sub ax,16:ds[bx+32]
mov 16:ss[bp+-20],ax
mov bx,16:ss[bp+6]
mov ax,16:ss[bp+-6]
sub ax,16:ds[bx+30]
mov 16:ss[bp+-18],ax
mov bx,16:ss[bp+6]
mov ax,16:ss[bp+-12]
sub ax,16:ds[bx+32]
mov 16:ss[bp+-16],ax
lea ax,16:ss[bp+-26]
push ax
lea ax,16:ss[bp+-22]
push ax
push 16:ss[bp+10]
callf $segments
add sp,#6
or ax,ax
je @LC
mov bx,16:ss[bp+6]
mov ax,16:ds[bx+120]
mov 16:ds[si+120],ax
mov bx,16:ss[bp+6]
mov 16:ds[bx+120],si
mov ax,16:ds[si+128]
mov 16:ss[bp+-2],ax
LC: inc 16:ss[bp+-2]
mov ax,16:ds[si+128]
cmp ax,16:ss[bp+-2]
jge @LD
xor di,di
jmp @LF
LD: add di,#4
mov ax,16:ss[bp+-6]
mov 16:ss[bp+-4],ax
mov ax,16:ss[bp+-12]
mov 16:ss[bp+-10],ax
mov ax,16:ds[si+128]
cmp ax,16:ss[bp+-2]
jne @LE
mov ax,16:ss[bp+-8]
mov 16:ss[bp+-6],ax
mov ax,16:ss[bp+-14]
mov 16:ss[bp+-12],ax
jmp @LF
LE: mov al,8:ds[di+4]
mov ah,#0
mov dx,16:ds[si+30]
add dx,ax
mov 16:ss[bp+-6],dx
mov al,8:ds[di+5]
mov ah,#0
mov dx,16:ds[si+32]
add dx,ax
mov 16:ss[bp+-12],dx
LF: or di,di
je @LG
jmp @LB
LG: mov ax,16:ss[bp+8]
and ax,#4096
push ax
push si
callf $listNext
pop cx
pop cx
LH: mov si,ax
or si,si
je @LI
jmp @LA
LI: pop di
pop si
mov sp,bp
pop bp
retf`,
];
