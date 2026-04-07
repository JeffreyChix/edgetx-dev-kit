---@meta
-- bit32: Lua 5.2 bitwise operations library.
-- Supported by EdgeTX despite Lua 5.3+ deprecation.
-- Consider using native operators (&, |, ~, >>, <<) for future compatibility.

---@deprecated Use native Lua 5.3+ bitwise operators (&, |, ~, >>, <<) for future compatibility
---@class bit32lib
local bit32lib = {}

---Returns the number x shifted disp bits to the right (arithmetic shift).
---Negative displacements shift to the left.
---Vacant bits on the left are filled with copies of the highest bit of x.
---@deprecated
---@param x integer
---@param disp integer
---@return integer
function bit32lib.arshift(x, disp) end

---Returns the bitwise AND of its operands.
---@deprecated
---@param ... integer
---@return integer
function bit32lib.band(...) end

---Returns the bitwise NOT of x.
---Identity: bit32.bnot(x) == (-1 - x) % 2^32
---@deprecated
---@param x integer
---@return integer
function bit32lib.bnot(x) end

---Returns the bitwise OR of its operands.
---@deprecated
---@param ... integer
---@return integer
function bit32lib.bor(...) end

---Returns true if the bitwise AND of its operands is not zero.
---@deprecated
---@param ... integer
---@return boolean
function bit32lib.btest(...) end

---Returns the bitwise XOR of its operands.
---@deprecated
---@param ... integer
---@return integer
function bit32lib.bxor(...) end

---Returns the unsigned number formed by bits field to field+width-1 from n.
---Bits are numbered 0 (least significant) to 31 (most significant).
---@deprecated
---@param n integer
---@param field integer Bit position (0-31)
---@param width? integer Number of bits to extract (default: 1)
---@return integer
function bit32lib.extract(n, field, width) end

---Returns a copy of n with bits field to field+width-1 replaced by v.
---@deprecated
---@param n integer
---@param v integer Replacement value
---@param field integer Bit position (0-31)
---@param width? integer Number of bits to replace (default: 1)
---@return integer
function bit32lib.replace(n, field, v, width) end

---Returns x rotated disp bits to the left.
---Negative displacements rotate to the right.
---@deprecated
---@param x integer
---@param disp integer
---@return integer
function bit32lib.lrotate(x, disp) end

---Returns x shifted disp bits to the left (logical shift).
---Negative displacements shift to the right. Vacant bits filled with zeros.
---@deprecated
---@param x integer
---@param disp integer
---@return integer
function bit32lib.lshift(x, disp) end

---Returns x rotated disp bits to the right.
---Negative displacements rotate to the left.
---@deprecated
---@param x integer
---@param disp integer
---@return integer
function bit32lib.rrotate(x, disp) end

---Returns x shifted disp bits to the right (logical shift).
---Negative displacements shift to the left. Vacant bits filled with zeros.
---@deprecated
---@param x integer
---@param disp integer
---@return integer
function bit32lib.rshift(x, disp) end

---@type bit32lib
bit32 = {}