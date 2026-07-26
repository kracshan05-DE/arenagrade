'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import ImageUpload from '@/components/ImageUpload'

interface Product {
  id: string
  name: string
  description: string
  category: string
  price_lkr: number
  stock_quantity: number
  low_stock_threshold: number
  is_active: boolean
  sku: string
  is_bulk_available: boolean
  bulk_min_qty: number | null
  bulk_price_lkr: number | null
  images: string[]
  created_at: string
}

const CATEGORIES = ['basketball', 'squash', 'tennis', 'badminton', 'futsal', 'accessories', 'other']

const CATEGORY_ICONS: Record<string, string> = {
  basketball: '🏀',
  squash: '🎾',
  tennis: '🎾',
  badminton: '🏸',
  futsal: '⚽',
  accessories: '🎽',
  other: '📦',
}

const emptyProduct = {
  name: '',
  description: '',
  category: 'basketball',
  price_lkr: 0,
  stock_quantity: 0,
  low_stock_threshold: 10,
  is_active: true,
  sku: '',
  is_bulk_available: false,
  bulk_min_qty: null as number | null,
  bulk_price_lkr: null as number | null,
  images: [] as string[],
}

export default function AdminProducts() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [form, setForm] = useState({ ...emptyProduct })
  const [message, setMessage] = useState('')
  const [filter, setFilter] = useState('all')

  useEffect(() => { loadProducts() }, [])

  const loadProducts = async () => {
    setLoading(true)
    const { data } = await supabase.from('products').select('*').order('created_at', { ascending: false })
    if (data) setProducts(data)
    setLoading(false)
  }

  const openAdd = () => {
    setForm({ ...emptyProduct })
    setEditingProduct(null)
    setShowForm(true)
  }

  const openEdit = (product: Product) => {
    setForm({
      name: product.name,
      description: product.description || '',
      category: product.category,
      price_lkr: product.price_lkr,
      stock_quantity: product.stock_quantity,
      low_stock_threshold: product.low_stock_threshold,
      is_active: product.is_active,
      sku: product.sku || '',
      is_bulk_available: product.is_bulk_available,
      bulk_min_qty: product.bulk_min_qty,
      bulk_price_lkr: product.bulk_price_lkr,
      images: product.images || [],
    })
    setEditingProduct(product)
    setShowForm(true)
  }

  const saveProduct = async () => {
    if (!form.name || form.price_lkr <= 0) {
      setMessage('Please enter a product name and valid price.')
      return
    }
    const payload = {
      name: form.name,
      description: form.description,
      category: form.category,
      price_lkr: parseFloat(String(form.price_lkr)),
      stock_quantity: parseInt(String(form.stock_quantity)),
      low_stock_threshold: parseInt(String(form.low_stock_threshold)),
      is_active: form.is_active,
      sku: form.sku || null,
      is_bulk_available: form.is_bulk_available,
      bulk_min_qty: form.is_bulk_available ? parseInt(String(form.bulk_min_qty || 0)) : null,
      bulk_price_lkr: form.is_bulk_available ? parseFloat(String(form.bulk_price_lkr || 0)) : null,
      images: form.images || [],
    }
    if (editingProduct) {
      const { error } = await supabase.from('products').update(payload).eq('id', editingProduct.id)
      if (error) { setMessage('Error: ' + error.message); return }
      setMessage('Product updated successfully.')
    } else {
      const { error } = await supabase.from('products').insert(payload)
      if (error) { setMessage('Error: ' + error.message); return }
      setMessage('Product added successfully.')
    }
    setShowForm(false)
    setEditingProduct(null)
    await loadProducts()
  }

  const toggleActive = async (product: Product) => {
    await supabase.from('products').update({ is_active: !product.is_active }).eq('id', product.id)
    await loadProducts()
  }

  const updateStock = async (product: Product, delta: number) => {
    const newQty = Math.max(0, product.stock_quantity + delta)
    await supabase.from('products').update({ stock_quantity: newQty }).eq('id', product.id)
    await loadProducts()
  }

  const filteredProducts = filter === 'all'
    ? products
    : filter === 'low_stock'
    ? products.filter(p => p.stock_quantity <= p.low_stock_threshold)
    : products.filter(p => p.category === filter)

  const lowStockCount = products.filter(p => p.stock_quantity <= p.low_stock_threshold && p.is_active).length

  return (
    <div style={{ padding: '28px 32px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0F172A', margin: '0 0 4px' }}>Products</h1>
          <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>Manage your sports equipment store</p>
        </div>
        <button onClick={openAdd}
          style={{ background: '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
          + Add Product
        </button>
      </div>

      {message && (
        <div style={{ background: '#ECFDF5', border: '0.5px solid #6EE7B7', borderRadius: '8px', padding: '10px 16px', marginBottom: '16px' }}>
          <p style={{ fontSize: '13px', color: '#065F46', margin: 0 }}>✅ {message}</p>
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {[
          { key: 'all', label: 'All', alert: false, count: 0 },
          { key: 'low_stock', label: 'Low Stock', alert: lowStockCount > 0, count: lowStockCount },
          ...CATEGORIES.map(c => ({ key: c, label: c.charAt(0).toUpperCase() + c.slice(1), alert: false, count: 0 })),
        ].map(tab => (
          <button key={tab.key} onClick={() => setFilter(tab.key)}
            style={{
              background: filter === tab.key ? '#1B6B3A' : '#fff',
              color: filter === tab.key ? '#fff' : '#64748B',
              border: `0.5px solid ${filter === tab.key ? '#1B6B3A' : '#E2E8F0'}`,
              borderRadius: '8px', padding: '6px 12px', fontSize: '12px', fontWeight: '500', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '4px',
            }}>
            {tab.label}
            {tab.alert && tab.count > 0 && (
              <span style={{ background: '#DC2626', color: '#fff', borderRadius: '20px', padding: '1px 6px', fontSize: '10px' }}>{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '20px', marginBottom: '20px' }}>
          <p style={{ fontSize: '14px', fontWeight: '600', color: '#0F172A', margin: '0 0 16px' }}>
            {editingProduct ? `Editing: ${editingProduct.name}` : 'Add New Product'}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>

            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>PRODUCT NAME *</label>
              <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                placeholder="e.g. Spalding NBA Basketball"
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
            </div>

            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>DESCRIPTION</label>
              <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})}
                placeholder="Product description..." rows={3}
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box', resize: 'vertical' }} />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>CATEGORY</label>
              <select value={form.category} onChange={e => setForm({...form, category: e.target.value})}
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', background: '#fff' }}>
                {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_ICONS[c]} {c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>SKU</label>
              <input type="text" value={form.sku} onChange={e => setForm({...form, sku: e.target.value})}
                placeholder="e.g. SPL-NBA-001"
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>PRICE (LKR) *</label>
              <input type="number" value={form.price_lkr} onChange={e => setForm({...form, price_lkr: parseFloat(e.target.value)})}
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>STOCK QUANTITY</label>
              <input type="number" value={form.stock_quantity} onChange={e => setForm({...form, stock_quantity: parseInt(e.target.value)})}
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>LOW STOCK ALERT THRESHOLD</label>
              <input type="number" value={form.low_stock_threshold} onChange={e => setForm({...form, low_stock_threshold: parseInt(e.target.value)})}
                style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input type="checkbox" checked={form.is_active} onChange={e => setForm({...form, is_active: e.target.checked})} id="active_prod" />
              <label htmlFor="active_prod" style={{ fontSize: '13px', color: '#0F172A', cursor: 'pointer' }}>Product is active (visible in store)</label>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input type="checkbox" checked={form.is_bulk_available} onChange={e => setForm({...form, is_bulk_available: e.target.checked})} id="bulk_prod" />
              <label htmlFor="bulk_prod" style={{ fontSize: '13px', color: '#0F172A', cursor: 'pointer' }}>Enable bulk pricing</label>
            </div>

            {form.is_bulk_available && (
              <>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>MINIMUM BULK QTY</label>
                  <input type="number" value={form.bulk_min_qty || ''} onChange={e => setForm({...form, bulk_min_qty: parseInt(e.target.value)})}
                    style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '4px' }}>BULK PRICE (LKR)</label>
                  <input type="number" value={form.bulk_price_lkr || ''} onChange={e => setForm({...form, bulk_price_lkr: parseFloat(e.target.value)})}
                    style={{ width: '100%', border: '0.5px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
                </div>
              </>
            )}

            {/* Image Upload */}
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginBottom: '6px' }}>PRODUCT IMAGES</label>
              <ImageUpload
                folder="products"
                existingImages={form.images || []}
                onImagesChange={(urls) => setForm({...form, images: urls})}
                maxImages={5}
              />
            </div>

          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => { setShowForm(false); setEditingProduct(null) }}
              style={{ flex: 1, background: '#F1F5F9', color: '#64748B', border: 'none', borderRadius: '8px', padding: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={saveProduct}
              style={{ flex: 2, background: '#1B6B3A', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
              {editingProduct ? 'Save Changes' : 'Add Product'}
            </button>
          </div>
        </div>
      )}

      {/* Products list */}
      {loading ? (
        <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '48px', textAlign: 'center' }}>
          <p style={{ color: '#64748B' }}>Loading products...</p>
        </div>
      ) : filteredProducts.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: '12px', border: '0.5px solid #E2E8F0', padding: '48px', textAlign: 'center' }}>
          <div style={{ fontSize: '36px', marginBottom: '10px' }}>🛒</div>
          <p style={{ fontSize: '15px', fontWeight: '500', color: '#0F172A', margin: '0 0 4px' }}>No products found</p>
          <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>Click Add Product to get started</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filteredProducts.map(product => {
            const isLowStock = product.stock_quantity <= product.low_stock_threshold && product.is_active
            return (
              <div key={product.id} style={{ background: '#fff', borderRadius: '12px', border: `0.5px solid ${isLowStock ? '#FECACA' : '#E2E8F0'}`, padding: '16px 20px' }}>
                {isLowStock && (
                  <div style={{ background: '#FEE2E2', borderRadius: '6px', padding: '4px 10px', marginBottom: '10px', display: 'inline-block' }}>
                    <p style={{ fontSize: '11px', color: '#DC2626', fontWeight: '600', margin: 0 }}>⚠️ Low stock — only {product.stock_quantity} left</p>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    {/* Show first image or icon */}
                    {product.images && product.images.length > 0 ? (
                      <img src={product.images[0]} alt={product.name}
                        style={{ width: '52px', height: '52px', objectFit: 'cover', borderRadius: '10px', border: '0.5px solid #E2E8F0', flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: '52px', height: '52px', background: '#F8FAFC', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', flexShrink: 0, border: '0.5px solid #E2E8F0' }}>
                        {CATEGORY_ICONS[product.category] || '📦'}
                      </div>
                    )}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                        <p style={{ fontSize: '14px', fontWeight: '600', color: '#0F172A', margin: 0 }}>{product.name}</p>
                        <span style={{ fontSize: '10px', background: product.is_active ? '#ECFDF5' : '#F1F5F9', color: product.is_active ? '#065F46' : '#64748B', padding: '2px 7px', borderRadius: '20px', fontWeight: '500' }}>
                          {product.is_active ? 'Active' : 'Inactive'}
                        </span>
                        {product.sku && (
                          <span style={{ fontSize: '10px', color: '#94A3B8', fontFamily: 'monospace' }}>SKU: {product.sku}</span>
                        )}
                        {product.images && product.images.length > 0 && (
                          <span style={{ fontSize: '10px', color: '#64748B' }}>📸 {product.images.length} photo{product.images.length > 1 ? 's' : ''}</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <p style={{ fontSize: '14px', fontWeight: '700', color: '#1B6B3A', margin: 0 }}>LKR {product.price_lkr.toLocaleString()}</p>
                        {product.is_bulk_available && product.bulk_price_lkr && (
                          <p style={{ fontSize: '12px', color: '#1D4ED8', margin: 0 }}>Bulk: LKR {product.bulk_price_lkr.toLocaleString()} (min {product.bulk_min_qty})</p>
                        )}
                        <span style={{ fontSize: '12px', color: isLowStock ? '#DC2626' : '#64748B' }}>
                          Stock: {product.stock_quantity}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#F8FAFC', border: '0.5px solid #E2E8F0', borderRadius: '8px', padding: '4px 8px' }}>
                      <button onClick={() => updateStock(product, -1)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#DC2626', fontWeight: '700', padding: '0 4px' }}>−</button>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A', minWidth: '28px', textAlign: 'center' }}>{product.stock_quantity}</span>
                      <button onClick={() => updateStock(product, 1)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#1B6B3A', fontWeight: '700', padding: '0 4px' }}>+</button>
                    </div>
                    <button onClick={() => toggleActive(product)}
                      style={{ background: product.is_active ? '#FEE2E2' : '#ECFDF5', color: product.is_active ? '#DC2626' : '#065F46', border: 'none', borderRadius: '7px', padding: '6px 12px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
                      {product.is_active ? 'Hide' : 'Show'}
                    </button>
                    <button onClick={() => openEdit(product)}
                      style={{ background: '#F8FAFC', color: '#0F172A', border: '0.5px solid #E2E8F0', borderRadius: '7px', padding: '6px 12px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
                      Edit
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
