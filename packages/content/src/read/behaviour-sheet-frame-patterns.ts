/**
 * Complete compiler forms of the routines that load a part's pictures and build the frame list its type record keeps at
 * `+0x14`: the routine that loads one part's sheet and stores the list, the sheet loader, the reader of the sheet's frame
 * sizes, the routine that marks how each frame is packed, and the one that counts the frames.
 */
/** Loads `part<type>.bmp` and stores the frame list in the type record: TIM 1 in the data segment, Even More through ES. */
export const sheetStorePatterns = [
  `push bp
mov bp,sp
sub sp,#22
push si
mov si,16:ss[bp+6]
mov ax,#{prefix}
push ax
lea ax,16:ss[bp+-22]
push ax
callf $copy
pop cx
pop cx
mov ax,#10
push ax
lea ax,16:ss[bp+-8]
push ax
push si
callf $number
add sp,#6
lea ax,16:ss[bp+-8]
push ax
lea ax,16:ss[bp+-22]
push ax
callf $append
pop cx
pop cx
mov ax,#{suffix}
push ax
lea ax,16:ss[bp+-22]
push ax
callf $append
pop cx
pop cx
callf $idle
callf $before
lea ax,16:ss[bp+-22]
push ax
callf $loader
pop cx
push ax
mov ax,si
mov dx,#58
imul dx
mov bx,ax
pop ax
mov 16:ds[bx+{frameList}],ax
callf $after
callf $idle
pop si
mov sp,bp
pop bp
retf`,
  `push bp
mov bp,sp
sub sp,#22
push si
mov si,16:ss[bp+6]
mov ax,#{prefix}
push ax
lea ax,16:ss[bp+-22]
push ax
callf $copy
pop cx
pop cx
mov ax,#10
push ax
lea ax,16:ss[bp+-8]
push ax
push si
callf $number
add sp,#6
lea ax,16:ss[bp+-8]
push ax
lea ax,16:ss[bp+-22]
push ax
callf $append
pop cx
pop cx
mov ax,#{suffix}
push ax
lea ax,16:ss[bp+-22]
push ax
callf $append
pop cx
pop cx
callf $idle
callf $before
lea ax,16:ss[bp+-22]
push ax
callf $loader
pop cx
push ax
mov ax,si
mov dx,#58
imul dx
mov dx,#{recordSegment}
mov bx,ax
mov es,dx
pop ax
mov 16:es[bx+20],ax
callf $after
callf $idle
pop si
mov sp,bp
pop bp
retf`,
];
/** Loads a sheet and returns its frame list, or 0. The Even More CD picks between two allocators for the pixels. */
export const sheetLoaderPatterns = [
  `push bp
mov bp,sp
sub sp,#162
push si
push di
mov di,16:ss[bp+6]
mov 16:ss[bp+-2],#0
mov 16:ss[bp+-10],#0
mov 16:ss[bp+-12],#0
mov 16:ss[bp+-8],#0
push di
callf $handle
add sp,#2
or ax,ax
jne @labelA
mov 16:ss[bp+-8],#1
push di
callf $open
add sp,#2
mov di,ax
or ax,ax
jne @labelA
jmp @labelW
labelA: push di
lea ax,16:ss[bp+-94]
push ax
callf $mark
add sp,#4
xor ax,ax
push ax
mov ax,#{scn}
push ax
push di
callf $find
add sp,#6
cmp dx,#-1
jne @labelB
cmp ax,#65535
je @labelD
labelB: push di
lea ax,16:ss[bp+-162]
push ax
callf $mark
add sp,#4
lea ax,16:ss[bp+-94]
push ax
callf $restore
add sp,#2
lea ax,16:ss[bp+-2]
push ax
lea ax,16:ss[bp+-4]
push ax
push di
callf $reader
add sp,#6
or ax,ax
jne @labelC
jmp @labelW
labelC: push 16:ss[bp+-2]
mov ax,#65534
push ax
call $kinds
add sp,#4
lea ax,16:ss[bp+-162]
push ax
callf $restore
add sp,#2
mov 16:ss[bp+-26],#0
jmp @labelG
labelD: xor ax,ax
push ax
mov ax,#{off}
push ax
push di
callf $find
add sp,#6
cmp dx,#-1
jne @labelE
cmp ax,#65535
jne @labelE
jmp @labelR
labelE: push di
mov ax,#1
push ax
mov ax,#2
push ax
lea ax,16:ss[bp+-26]
push ax
callf $read
add sp,#8
lea ax,16:ss[bp+-94]
push ax
callf $restore
add sp,#2
lea ax,16:ss[bp+-2]
push ax
lea ax,16:ss[bp+-4]
push ax
push di
callf $reader
add sp,#6
or ax,ax
jne @labelF
jmp @labelW
labelF: push 16:ss[bp+-2]
mov ax,#65535
push ax
call $kinds
add sp,#4
xor ax,ax
push ax
mov ax,#{vqt}
push ax
push di
callf $find
add sp,#6
cmp dx,#-1
jne @labelG
cmp ax,#65535
jne @labelG
jmp @labelW
labelG: cmp 16:ss[bp+-26],#0
je @labelH
jmp @labelN
labelH: push di
callf $size
add sp,#2
mov 16:ss[bp+-22],dx
mov 16:ss[bp+-24],ax
xor ax,ax
push ax
push ax
push 16:ss[bp+-22]
push 16:ss[bp+-24]
callf $alloc
add sp,#8
mov 16:ss[bp+-10],dx
mov 16:ss[bp+-12],ax
or ax,dx
jne @labelI
jmp @labelW
labelI: push di
push 16:ss[bp+-22]
push 16:ss[bp+-24]
push 16:ss[bp+-10]
push 16:ss[bp+-12]
call $readData
add sp,#10
xor ax,ax
push ax
mov ax,#{offAgain}
push ax
push di
callf $find
add sp,#6
cmp dx,#-1
jne @labelJ
cmp ax,#65535
jne @labelJ
push 16:ss[bp+-10]
push 16:ss[bp+-12]
callf $release
add sp,#4
jmp @labelW
labelJ: mov 16:ss[bp+-6],#0
jmp @labelM
labelK: push di
mov ax,#1
push ax
mov ax,#4
push ax
lea ax,16:ss[bp+-20]
push ax
callf $read
add sp,#8
cmp ax,#1
je @labelL
push 16:ss[bp+-10]
push 16:ss[bp+-12]
callf $release
add sp,#4
jmp @labelW
labelL: mov dx,16:ss[bp+-10]
mov ax,16:ss[bp+-12]
mov cx,16:ss[bp+-18]
mov bx,16:ss[bp+-20]
callf $hugeAdd
mov 16:ss[bp+-14],dx
mov 16:ss[bp+-16],ax
mov ax,16:ss[bp+-6]
shl ax,#1
mov bx,16:ss[bp+-2]
add bx,ax
mov si,16:ds[bx+0]
mov ax,16:ss[bp+-14]
mov 16:ds[si+0],ax
mov ax,16:ss[bp+-16]
mov 16:ds[si+2],ax
inc 16:ss[bp+-6]
labelM: mov ax,16:ss[bp+-6]
cmp ax,16:ss[bp+-4]
jl @labelK
jmp @labelS
labelN: lea ax,16:ss[bp+-6]
push ax
push 16:ss[bp+-2]
callf *32:ds[{hook}]
add sp,#4
mov 16:ss[bp+-22],dx
mov 16:ss[bp+-24],ax
xor ax,ax
push ax
push ax
push 16:ss[bp+-22]
push 16:ss[bp+-24]
callf $alloc
add sp,#8
mov 16:ss[bp+-10],dx
mov 16:ss[bp+-12],ax
or ax,dx
jne @labelO
jmp @labelW
labelO: push 16:ss[bp+-2]
mov ax,#65532
push ax
call $kinds
add sp,#4
mov 16:ss[bp+-6],#0
jmp @labelQ
labelP: mov ax,16:ss[bp+-6]
shl ax,#1
mov bx,16:ss[bp+-2]
add bx,ax
mov si,16:ds[bx+0]
mov ax,16:ss[bp+-10]
mov 16:ds[si+0],ax
mov ax,16:ss[bp+-12]
mov 16:ds[si+2],ax
mov ax,16:ds[si+6]
imul 16:ds[si+8]
xor cx,cx
mov dx,ss
push ax
lea ax,16:ss[bp+-12]
pop bx
callf $hugeStep
inc 16:ss[bp+-6]
labelQ: mov ax,16:ss[bp+-6]
cmp ax,16:ss[bp+-4]
jl @labelP
push 16:ss[bp+-2]
push di
call $unpackVqt
add sp,#4
jmp @labelS
labelR: push di
callf $bin
add sp,#2
mov 16:ss[bp+-2],ax
labelS: push 16:ss[bp+-2]
nop
push cs
call $count
add sp,#2
mov 16:ss[bp+-4],ax
xor ax,ax
push ax
mov ax,#{rle}
push ax
push di
callf $find
add sp,#6
cmp dx,#-1
jne @labelT
cmp ax,#65535
je @labelU
labelT: mov al,#16
push ax
push 16:ss[bp+-2]
callf $markRle
add sp,#4
labelU: xor ax,ax
push ax
mov ax,#{scl}
push ax
push di
callf $find
add sp,#6
cmp dx,#-1
jne @labelV
cmp ax,#65535
je @labelX
labelV: push 16:ss[bp+-2]
mov ax,#65533
push ax
call $kinds
add sp,#4
jmp @labelX
labelW: push 16:ss[bp+-2]
nop
push cs
call $free
add sp,#2
mov 16:ss[bp+-2],#0
labelX: cmp 16:ss[bp+-8],#0
je @labelY
push di
callf $close
add sp,#2
labelY: mov ax,16:ss[bp+-2]
pop di
pop si
mov sp,bp
pop bp
retf`,
  `push bp
mov bp,sp
sub sp,#162
push si
push di
mov si,16:ss[bp+6]
mov 16:ss[bp+-2],#0
mov 16:ss[bp+-10],#0
mov 16:ss[bp+-12],#0
mov 16:ss[bp+-8],#0
push si
callf $handle
pop cx
or ax,ax
jne @labelA
mov 16:ss[bp+-8],#1
push si
callf $open
pop cx
mov si,ax
or ax,ax
jne @labelA
jmp @labelAD
labelA: push si
lea ax,16:ss[bp+-94]
push ax
callf $mark
pop cx
pop cx
xor ax,ax
push ax
mov ax,#{scn}
push ax
push si
callf $find
add sp,#6
cmp dx,#-1
jne @labelB
cmp ax,#65535
je @labelD
labelB: push si
lea ax,16:ss[bp+-162]
push ax
callf $mark
pop cx
pop cx
lea ax,16:ss[bp+-94]
push ax
callf $restore
pop cx
lea ax,16:ss[bp+-2]
push ax
lea ax,16:ss[bp+-4]
push ax
push si
callf $reader
add sp,#6
or ax,ax
jne @labelC
jmp @labelAD
labelC: push 16:ss[bp+-2]
mov ax,#65534
push ax
call $kinds
pop cx
pop cx
lea ax,16:ss[bp+-162]
push ax
callf $restore
pop cx
mov 16:ss[bp+-26],#0
jmp @labelG
labelD: xor ax,ax
push ax
mov ax,#{off}
push ax
push si
callf $find
add sp,#6
cmp dx,#-1
jne @labelE
cmp ax,#65535
jne @labelE
jmp @labelX
labelE: push si
mov ax,#1
push ax
mov ax,#2
push ax
lea ax,16:ss[bp+-26]
push ax
callf $read
add sp,#8
lea ax,16:ss[bp+-94]
push ax
callf $restore
pop cx
lea ax,16:ss[bp+-2]
push ax
lea ax,16:ss[bp+-4]
push ax
push si
callf $reader
add sp,#6
or ax,ax
jne @labelF
jmp @labelAD
labelF: push 16:ss[bp+-2]
mov ax,#65535
push ax
call $kinds
pop cx
pop cx
xor ax,ax
push ax
mov ax,#{vqt}
push ax
push si
callf $find
add sp,#6
cmp dx,#-1
jne @labelG
cmp ax,#65535
jne @labelG
jmp @labelAD
labelG: cmp 16:ss[bp+-26],#0
je @labelH
jmp @labelQ
labelH: push si
callf $size
pop cx
mov 16:ss[bp+-22],dx
mov 16:ss[bp+-24],ax
cmp 16:ds[{heapFlag}],#0
je @labelI
xor ax,ax
push ax
push ax
push 16:ss[bp+-22]
push 16:ss[bp+-24]
callf $alloc
jmp @labelJ
labelI: xor ax,ax
push ax
push ax
push 16:ss[bp+-22]
push 16:ss[bp+-24]
callf $allocNear
labelJ: add sp,#8
mov 16:ss[bp+-10],dx
mov 16:ss[bp+-12],ax
mov ax,16:ss[bp+-12]
or ax,16:ss[bp+-10]
jne @labelK
jmp @labelAD
labelK: push si
push 16:ss[bp+-22]
push 16:ss[bp+-24]
push 16:ss[bp+-10]
push 16:ss[bp+-12]
call $readData
add sp,#10
xor ax,ax
push ax
mov ax,#{offAgain}
push ax
push si
callf $find
add sp,#6
cmp dx,#-1
jne @labelL
cmp ax,#65535
jne @labelL
jmp @labelN
labelL: mov 16:ss[bp+-6],#0
jmp @labelP
labelM: push si
mov ax,#1
push ax
mov ax,#4
push ax
lea ax,16:ss[bp+-20]
push ax
callf $read
add sp,#8
cmp ax,#1
je @labelO
labelN: push 16:ss[bp+-10]
push 16:ss[bp+-12]
callf $release
pop cx
pop cx
jmp @labelAD
labelO: mov dx,16:ss[bp+-10]
mov ax,16:ss[bp+-12]
mov cx,16:ss[bp+-18]
mov bx,16:ss[bp+-20]
callf $hugeAdd
mov 16:ss[bp+-14],dx
mov 16:ss[bp+-16],ax
mov ax,16:ss[bp+-6]
shl ax,#1
mov bx,16:ss[bp+-2]
add bx,ax
mov di,16:ds[bx+0]
mov ax,16:ss[bp+-14]
mov 16:ds[di+0],ax
mov ax,16:ss[bp+-16]
mov 16:ds[di+2],ax
inc 16:ss[bp+-6]
labelP: mov ax,16:ss[bp+-6]
cmp ax,16:ss[bp+-4]
jl @labelM
jmp @labelW
labelQ: lea ax,16:ss[bp+-6]
push ax
push 16:ss[bp+-2]
callf *32:ds[{hook}]
pop cx
pop cx
mov 16:ss[bp+-22],dx
mov 16:ss[bp+-24],ax
cmp 16:ds[{heapFlag}],#0
je @labelR
xor ax,ax
push ax
push ax
push 16:ss[bp+-22]
push 16:ss[bp+-24]
callf $alloc
jmp @labelS
labelR: xor ax,ax
push ax
push ax
push 16:ss[bp+-22]
push 16:ss[bp+-24]
callf $allocNear
labelS: add sp,#8
mov 16:ss[bp+-10],dx
mov 16:ss[bp+-12],ax
mov ax,16:ss[bp+-12]
or ax,16:ss[bp+-10]
jne @labelT
jmp @labelAD
labelT: push 16:ss[bp+-2]
mov ax,#65532
push ax
call $kinds
pop cx
pop cx
mov 16:ss[bp+-6],#0
jmp @labelV
labelU: mov ax,16:ss[bp+-6]
shl ax,#1
mov bx,16:ss[bp+-2]
add bx,ax
mov di,16:ds[bx+0]
mov ax,16:ss[bp+-10]
mov 16:ds[di+0],ax
mov ax,16:ss[bp+-12]
mov 16:ds[di+2],ax
mov ax,16:ds[di+6]
imul 16:ds[di+8]
xor cx,cx
mov dx,ss
push ax
lea ax,16:ss[bp+-12]
pop bx
callf $hugeStep
inc 16:ss[bp+-6]
labelV: mov ax,16:ss[bp+-6]
cmp ax,16:ss[bp+-4]
jl @labelU
push 16:ss[bp+-2]
push si
call $unpackVqt
pop cx
pop cx
labelW: jmp @labelY
labelX: push si
callf $bin
pop cx
mov 16:ss[bp+-2],ax
labelY: push 16:ss[bp+-2]
nop
push cs
call $count
pop cx
mov 16:ss[bp+-4],ax
xor ax,ax
push ax
mov ax,#{rle}
push ax
push si
callf $find
add sp,#6
cmp dx,#-1
jne @labelZ
cmp ax,#65535
je @labelAA
labelZ: mov al,#16
push ax
push 16:ss[bp+-2]
callf $markRle
pop cx
pop cx
labelAA: xor ax,ax
push ax
mov ax,#{scl}
push ax
push si
callf $find
add sp,#6
cmp dx,#-1
jne @labelAB
cmp ax,#65535
je @labelAC
labelAB: push 16:ss[bp+-2]
mov ax,#65533
push ax
call $kinds
pop cx
pop cx
labelAC: jmp @labelAE
labelAD: push 16:ss[bp+-2]
nop
push cs
call $free
pop cx
mov 16:ss[bp+-2],#0
labelAE: cmp 16:ss[bp+-8],#0
je @labelAF
push si
callf $close
pop cx
labelAF: mov ax,16:ss[bp+-2]
jmp @labelAG
labelAG: pop di
pop si
mov sp,bp
pop bp
retf`,
];
/** Reads the `INF:` chunk into a list of frame records, the width at `+6` and the height at `+8`. */
export const frameSizeReaderPatterns = [
  `push bp
mov bp,sp
sub sp,#12
push si
push di
mov si,16:ss[bp+8]
mov 16:ss[bp+-12],#0
mov bx,16:ss[bp+10]
mov 16:ds[bx+0],#0
xor ax,ax
push ax
mov ax,#{inf}
push ax
push 16:ss[bp+6]
nop
push cs
call $find
add sp,#6
cmp dx,#-1
jne @labelA
cmp ax,#65535
jne @labelA
jmp @labelO
labelA: push 16:ss[bp+6]
mov ax,#1
push ax
mov ax,#2
push ax
push si
callf $read
add sp,#8
cmp ax,#1
je @labelB
jmp @labelO
labelB: mov ax,#1
push ax
mov ax,16:ds[si+0]
inc ax
shl ax,#1
push ax
callf $calloc
add sp,#4
mov bx,16:ss[bp+10]
mov 16:ds[bx+0],ax
or ax,ax
jne @labelC
jmp @labelL
labelC: push 16:ds[si+0]
mov ax,#10
push ax
callf $calloc
add sp,#4
mov bx,16:ss[bp+10]
mov bx,16:ds[bx+0]
mov 16:ds[bx+0],ax
or ax,ax
jne @labelD
jmp @labelL
labelD: push 16:ss[bp+6]
nop
push cs
call $size
inc sp
inc sp
add ax,#65534
adc dx,#-1
push ax
mov ax,16:ds[si+0]
shl ax,#1
shl ax,#1
push dx
cwd
pop bx
cmp bx,dx
pop dx
jg @labelF
jl @labelE
cmp dx,ax
jae @labelF
labelE: mov 16:ss[bp+-8],#1
jmp @labelG
labelF: mov ax,16:ds[si+0]
mov 16:ss[bp+-8],ax
labelG: mov ax,16:ss[bp+-8]
shl ax,#1
shl ax,#1
push ax
callf $malloc
inc sp
inc sp
mov 16:ss[bp+-12],ax
or ax,ax
jne @labelH
jmp @labelL
labelH: push 16:ss[bp+6]
mov ax,#1
push ax
mov ax,16:ss[bp+-8]
shl ax,#1
shl ax,#1
push ax
push 16:ss[bp+-12]
callf $read
add sp,#8
cmp ax,#1
jne @labelL
mov ax,16:ss[bp+-12]
mov 16:ss[bp+-2],ax
mov ax,16:ss[bp+-8]
shl ax,#1
mov dx,16:ss[bp+-12]
add dx,ax
mov 16:ss[bp+-4],dx
mov bx,16:ss[bp+10]
mov bx,16:ds[bx+0]
mov di,16:ds[bx+0]
mov bx,16:ss[bp+10]
mov ax,16:ds[bx+0]
mov 16:ss[bp+-10],ax
mov 16:ss[bp+-6],#0
jmp @labelK
labelI: mov bx,16:ss[bp+-10]
mov 16:ds[bx+0],di
mov bx,16:ss[bp+-2]
mov ax,16:ds[bx+0]
mov 16:ds[di+6],ax
mov bx,16:ss[bp+-4]
mov ax,16:ds[bx+0]
mov 16:ds[di+8],ax
mov ax,16:ds[si+0]
cmp ax,16:ss[bp+-8]
jne @labelJ
add 16:ss[bp+-2],#2
add 16:ss[bp+-4],#2
labelJ: add di,#10
add 16:ss[bp+-10],#2
inc 16:ss[bp+-6]
labelK: mov ax,16:ds[si+0]
cmp ax,16:ss[bp+-6]
jg @labelI
mov bx,16:ss[bp+-10]
mov 16:ds[bx+0],#0
push 16:ss[bp+-12]
callf $release
inc sp
inc sp
mov ax,#1
jmp @labelP
labelL: cmp 16:ss[bp+-12],#0
je @labelM
push 16:ss[bp+-12]
callf $release
inc sp
inc sp
labelM: mov bx,16:ss[bp+10]
cmp 16:ds[bx+0],#0
je @labelO
mov bx,16:ds[bx+0]
cmp 16:ds[bx+0],#0
je @labelN
mov bx,16:ss[bp+10]
mov bx,16:ds[bx+0]
push 16:ds[bx+0]
callf $release
inc sp
inc sp
labelN: mov bx,16:ss[bp+10]
push 16:ds[bx+0]
callf $release
inc sp
inc sp
labelO: xor ax,ax
labelP: pop di
pop si
mov sp,bp
pop bp
retf`,
];
/** Writes one word, how the frame is packed, at `+4` of every frame record. */
export const frameKindPatterns = [
  `push bp
mov bp,sp
push si
mov dx,16:ss[bp+4]
mov si,16:ss[bp+6]
jmp @labelB
labelA: mov bx,16:ds[si+0]
mov 16:ds[bx+4],dx
add si,#2
labelB: cmp 16:ds[si+0],#0
jne @labelA
pop si
pop bp
ret`,
  `push bp
mov bp,sp
push si
mov si,16:ss[bp+6]
jmp @labelB
labelA: mov bx,16:ds[si+0]
mov ax,16:ss[bp+4]
mov 16:ds[bx+4],ax
add si,#2
labelB: cmp 16:ds[si+0],#0
jne @labelA
pop si
pop bp
ret`,
];
/** Counts the frame records up to the list's 0. */
export const frameCountPatterns = [
  `push bp
mov bp,sp
mov cx,16:ss[bp+6]
xor dx,dx
or cx,cx
je @labelC
jmp @labelB
labelA: inc dx
labelB: mov ax,dx
shl ax,#1
mov bx,cx
add bx,ax
cmp 16:ds[bx+0],#0
jne @labelA
labelC: mov ax,dx
pop bp
retf`,
  `push bp
mov bp,sp
mov cx,16:ss[bp+6]
xor dx,dx
or cx,cx
je @labelC
jmp @labelB
labelA: inc dx
labelB: mov ax,dx
shl ax,#1
mov bx,cx
add bx,ax
cmp 16:ds[bx+0],#0
jne @labelA
labelC: mov ax,dx
jmp @labelD
labelD: pop bp
retf`,
];
